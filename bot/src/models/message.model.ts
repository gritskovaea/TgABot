import { pool } from "../db/index.js";

export type UserCountRow = {
  id: number;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  count: number;
};

export async function saveMessage(
    userId: number,
    chatId: number,
    text: string
) {
  await pool.query(
      `INSERT INTO messages (user_id, chat_id, text) VALUES ($1, $2, $3)`,
      [userId, chatId, text]
  );
}

export async function topUsers(chatId: number, from?: Date) {
  return pool.query<UserCountRow>(
    `
    SELECT u.id, u.username, u.first_name, u.last_name, COUNT(*)::int as count
    FROM messages m
    JOIN users u ON u.id = m.user_id
    WHERE chat_id = $1
    ${from ? "AND created_at >= $2" : ""}
    GROUP BY u.id, u.username, u.first_name, u.last_name
    ORDER BY count DESC
    LIMIT 10
    `,
    from ? [chatId, from] : [chatId]
  );
}

export async function messagesByUser(
  userId: number,
  limit = 100,
  chatId?: number
) {
  const res = await pool.query(
    `
    SELECT text FROM messages
    WHERE user_id = $1
    ${chatId ? "AND chat_id = $3" : ""}
    ORDER BY created_at DESC
    LIMIT $2
    `,
    chatId ? [userId, limit, chatId] : [userId, limit]
  );
  return res.rows.map(r => r.text);
}

export async function chatTotals(chatId: number, from?: Date) {
  const res = await pool.query(
    `
    SELECT COUNT(*)::int as messages, COUNT(DISTINCT user_id)::int as users
    FROM messages
    WHERE chat_id = $1
    ${from ? "AND created_at >= $2" : ""}
    `,
    from ? [chatId, from] : [chatId]
  );
  return res.rows[0] as { messages: number; users: number };
}

export async function userMessageCount(
  chatId: number,
  userId: number,
  from?: Date
) {
  const res = await pool.query(
    `
    SELECT COUNT(*)::int as count
    FROM messages
    WHERE chat_id = $1 AND user_id = $2
    ${from ? "AND created_at >= $3" : ""}
    `,
    from ? [chatId, userId, from] : [chatId, userId]
  );
  return res.rows[0]?.count ?? 0;
}

export async function userRank(
  chatId: number,
  userId: number,
  from?: Date
) {
  const res = await pool.query(
    `
    SELECT user_id, COUNT(*)::int as count
    FROM messages
    WHERE chat_id = $1
    ${from ? "AND created_at >= $2" : ""}
    GROUP BY user_id
    ORDER BY count DESC
    `,
    from ? [chatId, from] : [chatId]
  );

  const rows = res.rows as Array<{ user_id: number; count: number }>;
  const index = rows.findIndex(row => Number(row.user_id) === userId);
  const rank = index === -1 ? null : index + 1;

  return { rank, totalUsers: rows.length };
}
