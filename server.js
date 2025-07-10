const express = require('express');
const app = express();
const path = require('path');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const bcrypt = require('bcrypt');
const mysql = require('mysql2');

const PORT = 3000;

// 미들웨어
app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(cookieParser());
app.use(session({
  secret: 'midas_secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 } // 1시간
}));

// DB 연결
const connection = mysql.createConnection({
  host: '192.168.100.254',
  user: 'myuser',
  password: 'Midas0912@',
  database: 'midas_db',
  port: 3306,
});
connection.connect();

function isLoggedIn(req, res, next) {
  if (req.session && req.session.loginUserName) return next();
  res.redirect('/login');
}

// 메인 페이지
// app.get('/', (req, res) => {
//   res.render('midas', {
//     loginUserName: req.session.loginUserName,
//     loginUserId: req.session.loginUserId,
//     role: req.session.role  // 이 줄 추가
//   });
// });
// 회원가입 페이지
app.get('/join', (req, res) => {
  res.render('join');
});

// 회원가입 처리
app.post('/user', (req, res) => {
  console.log('✅ 회원가입 요청 수신됨');
  console.log('req.body:', req.body);

  const { userId, pw } = req.body;
  let role = req.body.role;

  // ✅ 'guardian'을 'guad'로 축약해서 저장
  if (role === 'guardian') {
    role = 'guad';
  }

  bcrypt.hash(pw, 10, (err, hash) => {
    if (err) {
      console.error('비밀번호 해시 실패:', err);
      return res.send('서버 오류');
    }

    connection.query(
      'INSERT INTO user (login_id, password, role) VALUES (?, ?, ?)',
      [userId, hash, role],
      (err, result) => {
        if (err) {
          console.error('회원가입 실패:', err);
          return res.send('회원가입에 실패했습니다.');
        }
        res.redirect('/login');
      }
    );
  });
});

// 로그인 페이지
app.get('/login', (req, res) => {
  res.render('login');
});

// 로그인 처리
// 수정된 코드: role 조건 제거
app.post('/login', (req, res) => {
  const { userId, pw } = req.body;

  connection.query(
    'SELECT * FROM user WHERE login_id = ?', // user_id → login_id로 수정도 반영
    [userId],
    (err, result) => {
      if (err) {
        console.error('로그인 오류:', err);
        return res.send('서버 오류');
      }

      if (result.length === 1) {
        const user = result[0];

        if (bcrypt.compareSync(pw, user.password)) {
          req.session.userId = user.user_id;
          req.session.loginUserName = user.login_id;
          req.session.loginUserId = user.login_id;
          req.session.role = user.role;  // DB에서 가져온 role을 세션에 저장
          console.log('✅ 로그인 성공 → 세션 정보:', req.session);
          res.redirect('/');
        } else {
          res.send('비밀번호가 틀렸습니다.');
        }
      } else {
        res.send('아이디가 존재하지 않습니다.');
      }
    }
  );
});


// 로그아웃
app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

// 더 간단한 기본 라우팅
app.get('/', (req, res) => {
  res.render('midas', {
    loginUserName: req.session.loginUserName,
    loginUserId: req.session.loginUserId,
    role: req.session.role
  });
});


// 서버 시작
app.listen(PORT, () => {
  console.log(`🚀 MIDAS 서버가 http://localhost:${PORT} 에서 실행 중입니다.`);
});

//about page 
app.get('/about', (req, res) => {
  if (!req.session.loginUserName) return res.redirect('/login');
  const loginUserName = req.session?.loginUserName;  // 로그인 세션에서 이름 가져오기
  res.render('about', { loginUserName });  // ✅ 변수 전달
});

//location page
app.get('/location', (req, res) => {
  if (!req.session.loginUserName) return res.redirect('/login');
  // event 테이블에서 가장 최근 위치 1개조회
  const sql = `
    SELECT latitude, longitude 
    FROM event 
    ORDER BY timestamp DESC 
    LIMIT 1
  `;

  connection.query(sql, (err, result) => {
    let lat = null;
    let lng = null;

    if (!err && result.length > 0) {
      lat = result[0].latitude;
      lng = result[0].longitude;
    }
    console.log('✅ [서버] DB에서 가져온 좌표 →', { lat, lng });

    // 렌더링 하면서  세션에 저장된 로그인 이름과 위도/경도 전달 
    res.render('location', {
      loginUserName: req.session.loginUserName,
      lat,
      lng
    });
  });
});

// ① 게시판 목록 페이지
app.get('/board', isLoggedIn, (req, res) => {
  const sql = `
    SELECT 
      b.id,
      b.title,
      b.created_at,
      u.login_id AS user_id
    FROM board AS b
    JOIN user  AS u
      ON b.user_id = u.user_id
    ORDER BY b.created_at DESC
  `;
  connection.query(sql, (err, contents) => {
    if (err) {
      console.error(err);
      return res.send('게시글 조회 오류');
    }
    res.render('board', {
      title: '게시판',
      contents,
      loginUserId:   req.session.loginUserId,
      loginUserName: req.session.loginUserName
    });
  });
});

// ② 글 작성 폼
app.get('/board/new', isLoggedIn, (req, res) => {
  res.render('form', { content: {},
  loginUserName: req.session.loginUserName });
});

// ③ 글 등록
app.post('/board', isLoggedIn, (req, res) => {
  const { title, content } = req.body;
  const sql = `INSERT INTO board (user_id, title, content) VALUES (?, ?, ?)`;
  connection.query(sql,
    [req.session.userId, title, content],
    err => {
      if (err) {
        console.error(err);
        return res.send('글 작성 오류');
      }
      res.redirect('/board');
    });
});

// ④ 글 상세보기
app.get('/board/:id', isLoggedIn, (req, res) => {
  const id = req.params.id;
  connection.query(
    `SELECT b.*, u.login_id AS user_id
       FROM board b
       JOIN user  u ON b.user_id = u.user_id
      WHERE b.id = ?`, [id],
    (err, rows) => {
      if (err || rows.length === 0) return res.redirect('/board');
      const content = rows[0];
      // (댓글은 나중에)
      res.render('post', {
        content,
        comments:      [], 
        loginUserId:   req.session.loginUserId,
        loginUserName: req.session.loginUserName
      });
    }
  );
});

// ⑤ 글 수정 폼 (form.ejs 재활용)
app.get('/board/:id/edit', isLoggedIn, (req, res) => {
  connection.query(
    'SELECT * FROM board WHERE id = ?', [req.params.id],
    (err, rows) => {
      if (err || rows.length === 0) return res.redirect('/board');
      res.render('form', { content: rows[0] });
    }
  );
});

// ⑥ 글 수정 처리
app.post('/board/:id', isLoggedIn, (req, res) => {
  const { title, content } = req.body;
  connection.query(
    'UPDATE board SET title = ?, content = ? WHERE id = ?',
    [title, content, req.params.id],
    err => {
      if (err) return res.send('글 수정 오류');
      res.redirect(`/board/${req.params.id}`);
    }
  );
});

//게시글 수정
app.get('/board/:id', isLoggedIn, (req, res) => {
  const postId = req.params.id;
  // 1) 게시글 정보 조회 (id AS no, 작성자 로그인ID AS name)
  const postSql = `
    SELECT 
      b.id         AS no,
      b.title,
      b.content,
      b.created_at,
      u.login_id   AS name,
      b.user_id
    FROM board b
    JOIN user  u ON b.user_id = u.user_id
    WHERE b.id = ?
  `;
  connection.query(postSql, [postId], (err, postRows) => {
    if (err || postRows.length === 0) return res.redirect('/board');
    const content = postRows[0];

    // 2) 댓글 목록 조회 (작성자 로그인ID AS commenter)
    const cmtSql = `
      SELECT 
        c.id,
        c.content,
        c.created_at,
        u.login_id AS commenter
      FROM comments c
      JOIN user     u ON c.user_id = u.user_id
      WHERE c.post_id = ?
      ORDER BY c.created_at ASC
    `;
    connection.query(cmtSql, [postId], (err2, comments) => {
      if (err2) {
        console.error(err2);
        return res.send('댓글 조회 오류');
      }
      // 3) 뷰에 전달
      res.render('post', {
        content,
        comments,
        loginUserId:   req.session.user_id,     // 숫자 PK 담아둔 세션
        loginUserName: req.session.loginUserName
      });
    });
  });
});

// 댓글 작성 처리
app.post('/comments', isLoggedIn, (req, res) => {
  const { postNo, content } = req.body;
  const sql = `
    INSERT INTO comments (post_id, user_id, content)
    VALUES (?, ?, ?)
  `;
  connection.query(
    sql,
    [postNo, req.session.user_id, content],
    err => {
      if (err) {
        console.error(err);
        return res.send('댓글 작성 오류');
      }
      res.redirect(`/board/${postNo}`);
    }
  );
});

// mypage 라우트
// server.js (또는 app.js) 어딘가
app.locals.formatDate = date => {
  const d = new Date(date);
  // "YYYY-MM-DD HH:MM:SS" 형태로 포맷
  return d.toISOString().slice(0,19).replace('T',' ');
};

app.get('/mypage', isLoggedIn, (req, res) => {
  const sql = `
    SELECT latitude, longitude, timestamp
    FROM event
    ORDER BY timestamp DESC
    LIMIT 10
  `;
  connection.query(sql, (err, results) => {
    if (err) {
      console.error('최근 위치 조회 오류:', err);
      return res.send('최근 위치를 불러오는 데 실패했습니다.');
    }
    // 결과를 뷰에 맞게 가공
    const recentLocations = results.map(row => ({
      lat: row.latitude,
      lng: row.longitude,
      timestamp: row.timestamp
    }));
    // 맵에 표시할 최신 위치
    const first = recentLocations[0] || {};
    const lat = first.lat || null;
    const lng = first.lng || null;

    res.render('mypage', {
      loginUserName: req.session.loginUserName,
      lat,
      lng,
      recentLocations
    });
  });
});
