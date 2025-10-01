// server.js (최종본)

const express = require('express');
const app = express();
const path = require('path');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const bcrypt = require('bcrypt');
const mysql = require('mysql2');
const methodOverride = require('method-override');

const PORT = process.env.PORT || 4000;

// ──────────────────────────────────────
// 기본 설정 & 미들웨어
// ──────────────────────────────────────
app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: true }));
app.use(express.json()); // ✅ JSON 파서 추가
app.use(express.static(path.join(__dirname, 'public')));
app.use(cookieParser());
app.use(methodOverride('_method'));

// 프록시(nginx) 뒤에 있을 수 있으므로 신뢰 설정
app.set('trust proxy', 1);

// 세션
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'midas_secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 1000 * 60 * 60, // 1시간
      sameSite: 'lax',
      secure: false, // https 프록시 사용 시 true 권장 (nginx TLS 종단이면 여기 false 유지)
    },
  })
);

// 모든 EJS에서 사용 가능한 날짜 포맷터
app.locals.formatDate = (date) => {
  const d = new Date(date);
  return d.toISOString().slice(0, 19).replace('T', ' ');
};

// ──────────────────────────────────────
// DB: 커넥션 풀
// ──────────────────────────────────────
const pool = mysql.createPool({
  host: '127.0.0.1',
  user: 'midas',
  password: '0391',
  database: 'midas_db',
  port: 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  timezone: 'Z', // UTC 고정
});

// 공통 미들웨어
function isLoggedIn(req, res, next) {
  if (req.session && req.session.loginUserName) return next();
  return res.redirect('/login');
}

// ──────────────────────────────────────
// 라우팅
// ──────────────────────────────────────

// 회원가입 페이지
app.get('/join', (req, res) => {
  res.render('join');
});

// 회원가입 처리
app.post('/user', (req, res) => {
  const { userId, pw } = req.body;
  let role = req.body.role;

  if (role === 'guardian') role = 'guad'; // ✅ 약어 유지

  bcrypt.hash(pw, 10, (err, hash) => {
    if (err) {
      console.error('비밀번호 해시 실패:', err);
      return res.status(500).send('서버 오류');
    }
    pool.query(
      'INSERT INTO user (login_id, password, role) VALUES (?, ?, ?)',
      [userId, hash, role],
      (qErr) => {
        if (qErr) {
          console.error('회원가입 실패:', qErr);
          return res.status(500).send('회원가입에 실패했습니다.');
        }
        return res.redirect('/login');
      }
    );
  });
});

// 로그인 페이지
app.get('/login', (req, res) => {
  res.render('login');
});

// 로그인 처리
app.post('/login', (req, res) => {
  const { userId, pw } = req.body;

  pool.query('SELECT * FROM user WHERE login_id = ?', [userId], (err, rows) => {
    if (err) {
      console.error('로그인 오류:', err);
      return res.status(500).send('서버 오류');
    }
    if (rows.length !== 1) return res.send('아이디가 존재하지 않습니다.');

    const user = rows[0];
    if (!bcrypt.compareSync(pw, user.password))
      return res.send('비밀번호가 틀렸습니다.');

    req.session.userId = user.user_id;
    req.session.loginUserName = user.login_id;
    req.session.loginUserId = user.login_id;
    req.session.role = user.role;

    console.log('✅ 로그인 성공 → 세션:', {
      userId: req.session.userId,
      loginUserName: req.session.loginUserName,
      role: req.session.role,
    });
    return res.redirect('/');
  });
});

// 로그아웃
app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

// 메인
app.get('/', isLoggedIn, (req, res) => {
  res.render('midas', {
    loginUserName: req.session.loginUserName,
    loginUserId: req.session.loginUserId,
    role: req.session.role,
  });
});

// about
app.get('/about', isLoggedIn, (req, res) => {
  res.render('about', { loginUserName: req.session.loginUserName });
});

// location: 최근 1개 좌표
app.get('/location', isLoggedIn, (req, res) => {
  const sql = `
    SELECT latitude, longitude
    FROM event
    ORDER BY timestamp DESC
    LIMIT 1
  `;
  pool.query(sql, (err, rows) => {
    let lat = null;
    let lng = null;
    if (!err && rows.length > 0) {
      lat = rows[0].latitude;
      lng = rows[0].longitude;
    }
    console.log('✅ [서버] DB에서 가져온 좌표 →', { lat, lng });
    return res.render('location', {
      loginUserName: req.session.loginUserName,
      lat,
      lng,
    });
  });
});

// 게시판 목록
app.get('/board', isLoggedIn, (req, res) => {
  const sql = `
    SELECT
      b.id,
      b.title,
      CONVERT_TZ(b.created_at, '+00:00', '+09:00') AS created_at,
      u.login_id AS user_id
    FROM board AS b
    JOIN user  AS u ON b.user_id = u.user_id
    ORDER BY b.created_at DESC
  `;
  pool.query(sql, (err, contents) => {
    if (err) {
      console.error(err);
      return res.status(500).send('게시글 조회 오류');
    }
    return res.render('board', {
      title: '게시판',
      contents,
      loginUserId: req.session.loginUserId,
      loginUserName: req.session.loginUserName,
    });
  });
});

// 글 작성 폼
app.get('/board/new', isLoggedIn, (req, res) => {
  res.render('form', {
    content: {},
    loginUserName: req.session.loginUserName,
  });
});

// 글 등록
app.post('/board', isLoggedIn, (req, res) => {
  const { title, content } = req.body;
  pool.query(
    'INSERT INTO board (user_id, title, content) VALUES (?, ?, ?)',
    [req.session.userId, title, content],
    (err) => {
      if (err) {
        console.error(err);
        return res.status(500).send('글 작성 오류');
      }
      return res.redirect('/board');
    }
  );
});

// 글 상세 + 댓글
app.get('/board/:id', isLoggedIn, (req, res) => {
  const postId = req.params.id;

  const postSql = `
    SELECT
      b.id AS no,
      b.title,
      b.content,
      b.created_at,
      u.login_id AS name,
      b.user_id
    FROM board b
    JOIN user u ON b.user_id = u.user_id
    WHERE b.id = ?
  `;
  pool.query(postSql, [postId], (err, postRows) => {
    if (err || postRows.length === 0) return res.redirect('/board');
    const content = postRows[0];

    const cmtSql = `
      SELECT
        c.id,
        c.content,
        c.created_at,
        c.user_id,
        u.login_id AS commenter
      FROM comments c
      JOIN user u ON c.user_id = u.user_id
      WHERE c.post_id = ?
      ORDER BY c.created_at ASC
    `;
    pool.query(cmtSql, [postId], (e2, comments) => {
      if (e2) {
        console.error(e2);
        return res.status(500).send('댓글 조회 오류');
      }
      return res.render('post', {
        content,
        comments,
        loginUserId: req.session.loginUserId,
        loginUserName: req.session.loginUserName,
      });
    });
  });
});

// 글 수정 폼
app.get('/board/:id/edit', isLoggedIn, (req, res) => {
  const postId = req.params.id;
  pool.query('SELECT * FROM board WHERE id = ?', [postId], (err, rows) => {
    if (err || rows.length === 0) return res.redirect('/board');
    const post = rows[0];
    if (post.user_id !== req.session.userId)
      return res.status(403).send('권한이 없습니다.');
    post.no = post.id;
    return res.render('form', {
      content: post,
      loginUserName: req.session.loginUserName,
      loginUserId: req.session.loginUserId,
    });
  });
});

// 글 수정 처리(PUT)
app.put('/board/:id', isLoggedIn, (req, res) => {
  const postId = req.params.id;
  const { title, content } = req.body;

  // 작성자 권한 확인
  pool.query('SELECT user_id FROM board WHERE id = ?', [postId], (err, rows) => {
    if (err || rows.length === 0) {
      return res.status(404).send('게시글을 찾을 수 없습니다.');
    }
    if (rows[0].user_id !== req.session.userId) {
      return res.status(403).send('권한이 없습니다.');
    }

    // 실제 업데이트
    pool.query(
      'UPDATE board SET title = ?, content = ? WHERE id = ?',
      [title, content, postId],
      (uErr) => {
        if (uErr) {
          console.error(uErr);
          return res.status(500).send('글 수정 오류');
        }
        return res.redirect(`/board/${postId}`);
      }
    );
  });
});
// --- 서버 시작 (모든 라우트 정의 이후에 위치해야 함) ---
app.listen(PORT, () => {
  console.log(`🚀 MIDAS 서버가 http://localhost:${PORT} 에서 실행 중입니다.`);
});
// mypage 라우트
// server.js의 /mypage 라우트 수정
app.get('/mypage', isLoggedIn, (req, res) => {
  const sql = `
    SELECT latitude, longitude, timestamp
    FROM event
    ORDER BY timestamp DESC
    LIMIT 5
  `;
  pool.query(sql, (err, results) => {
    if (err) {
      console.error('최근 위치 조회 오류:', err);
      return res.send('최근 위치를 불러오는 데 실패했습니다.');
    }
    
    const first = results[0] || {};
    const lat = first.latitude || null;
    const lng = first.longitude || null;

    res.render('mypage', {
      loginUserName: req.session.loginUserName,
      lat,
      lng,
      locationsData: results // ✅ 가공하지 않은 DB 결과(좌표)를 그대로 전달
    });
  });
});