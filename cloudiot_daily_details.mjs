// lambda.mjs
import mysql from "mysql2/promise";

const rds_host = process.env.RDS_HOST;
const db_user = process.env.DB_USER;
const db_password = process.env.DB_PASSWORD;
const db_name = process.env.DB_NAME;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
};

export const handler = async (event, context) => {
  if (event?.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: CORS_HEADERS };
  }

  // 1. Authorization 헤더에서 토큰 추출
  const headers = event?.headers || {};
  const authHeader = headers.Authorization || headers.authorization;
  if (!authHeader) {
    return {
      statusCode: 401,
      headers: CORS_HEADERS,
      body: "Authorization 토큰이 필요합니다.",
    };
  }
  const jwt_token = authHeader.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7)
    : authHeader;

  // 2. 요청 파싱
  let body;
  try {
    body = event.body ? JSON.parse(event.body) : event;
  } catch {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: "body 파싱 오류",
    };
  }

  const email = body?.email;
  const year = parseInt(body?.year, 10) || 0;
  const month = parseInt(body?.month, 10) || 0;
  const day = parseInt(body?.day, 10) || 0;

  if (!email || !year || !month || !day) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: "email, year, month, day 모두 필요합니다.",
    };
  }

  let conn;
  try {
    conn = await mysql.createConnection({
      host: rds_host,
      user: db_user,
      password: db_password,
      database: db_name,
      connectTimeout: 5000,
    });

    // 3. email → user_id, jwt_token
    const [userRows] = await conn.execute(
      "SELECT user_id, jwt_token FROM User WHERE email=?",
      [email]
    );
    if (userRows.length === 0) {
      return {
        statusCode: 404,
        headers: CORS_HEADERS,
        body: "해당 이메일의 사용자를 찾을 수 없습니다.",
      };
    }
    const { user_id, jwt_token: stored_jwt_token } = userRows[0];

    // 4. JWT 토큰 검증
    if (!stored_jwt_token || stored_jwt_token !== jwt_token) {
      return {
        statusCode: 401,
        headers: CORS_HEADERS,
        body: "유효하지 않은 토큰입니다.",
      };
    }

    // 5. 날짜로 sleep_id 찾기
    const sleepDate = `${year.toString().padStart(4, "0")}-${month
      .toString()
      .padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
    const [sleepRows] = await conn.execute(
      "SELECT sleep_id FROM SleepData WHERE user_id=? AND sleep_date=?",
      [user_id, sleepDate]
    );
    if (sleepRows.length === 0) {
      return {
        statusCode: 404,
        headers: CORS_HEADERS,
        body: "해당 날짜의 수면 데이터가 없습니다.",
      };
    }
    const { sleep_id } = sleepRows[0];

    // 6. SleepLevelSummary 조회
    const [summaryRows] = await conn.execute(
      "SELECT level, count, minutes FROM SleepLevelSummary WHERE sleep_id=?",
      [sleep_id]
    );
    const summary = summaryRows.map((row) => ({
      level: row.level,
      count: row.count,
      minutes: row.minutes,
    }));

    // 7. SleepLevelDetail 조회
    const [detailRows] = await conn.execute(
      "SELECT start_time, level, duration_sec FROM SleepLevelDetail WHERE sleep_id=? ORDER BY start_time",
      [sleep_id]
    );
    const detail = detailRows.map((row) => ({
      start_time: row.start_time + "",
      level: row.level,
      duration_sec: row.duration_sec,
    }));

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        sleep_id,
        summary,
        detail,
      }),
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: "서버 오류: " + (e?.message || e),
    };
  } finally {
    if (conn) await conn.end();
  }
};
