import { pool } from "../db/index.js";

type TelegramUser = {
  id: number;
  username?: string | null;
  first_name?: string | null;
  last_name?: string | null;
};

export async function upsertUser(user: TelegramUser) {
  await pool.query(
      `
    INSERT INTO users (id, username, first_name, last_name)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (id) DO UPDATE
    SET username=$2, first_name=$3, last_name=$4
    `,
      [user.id, user.username, user.first_name, user.last_name]
  );
}

export async function getUserByUsername(username: string) {
  const res = await pool.query(
      `SELECT * FROM users WHERE username = $1`,
      [username.replace("@", "")]
  );
  return res.rows[0];
}
