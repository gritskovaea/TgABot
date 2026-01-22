import { Markup, Telegraf } from "telegraf";
import type { Context } from "telegraf";
import { getUserByUsername, upsertUser } from "./models/user.model.js";
import {
  chatTotals,
  messagesByUser,
  saveMessage,
  topUsers,
  userMessageCount,
  userRank,
} from "./models/message.model.js";
import { analyze } from "./services/analyze.service.js";
import { redis, TTL } from "./services/cache.service.js";
import { waitForDb } from "./db/index.js";

const token = process.env.BOT_TOKEN ?? process.env["\ufeffBOT_TOKEN"];
if (!token) {
  throw new Error("BOT_TOKEN is required. Set it in .env before запуск.");
}

const bot = new Telegraf(token);

bot.catch((err, ctx: Context) => {
  console.error("Bot error:", err);
  if (ctx.updateType === "callback_query") {
    ctx.answerCbQuery("Произошла ошибка. Попробуйте позже.").catch(() => {});
  }
});

type RangeId = "all" | "day" | "week" | "month";
const rangeLabels: Record<RangeId, string> = {
  all: "за все время",
  day: "за сегодня",
  week: "за неделю",
  month: "за месяц",
};

function getRangeStart(range: RangeId): Date | undefined {
  const now = new Date();
  if (range === "day") {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }
  if (range === "week") {
    const start = new Date(now);
    start.setDate(now.getDate() - 7);
    return start;
  }
  if (range === "month") {
    const start = new Date(now);
    start.setMonth(now.getMonth() - 1);
    return start;
  }
  return undefined;
}

function displayName(user: {
  username: string | null;
  first_name: string | null;
  last_name: string | null;
}) {
  if (user.username) {
    return `@${user.username}`;
  }
  const first = user.first_name ?? "";
  const last = user.last_name ?? "";
  const full = `${first} ${last}`.trim();
  return full || "Unknown";
}

function formatUserLabel(user: {
  username?: string | null;
  first_name?: string | null;
  last_name?: string | null;
}) {
  if (user.username) {
    return `@${user.username}`;
  }
  const first = user.first_name ?? "";
  const last = user.last_name ?? "";
  const full = `${first} ${last}`.trim();
  return full || "Unknown";
}

function statsKeyboard(range: RangeId) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback("За сегодня", "stats:range:day"),
      Markup.button.callback("За неделю", "stats:range:week"),
      Markup.button.callback("За месяц", "stats:range:month"),
    ],
    [Markup.button.callback("За все время", "stats:range:all")],
    [Markup.button.callback("Статистика пользователя", `stats:userlist:${range}`)],
  ]);
}

async function buildTopStatsText(chatId: number, range: RangeId) {
  const from = getRangeStart(range);
  const cacheKey = `stats:top:${chatId}:${range}`;
  const cached = await redis.get(cacheKey);
  if (cached) return cached;

  const res = await topUsers(chatId, from);
  const totals = await chatTotals(chatId, from);

  if (res.rows.length === 0) {
    return `Нет данных ${rangeLabels[range]}.\n\nЕсли бот не видит сообщения, выключите Privacy Mode в BotFather.`;
  }

  const list = res.rows
    .map((row, i) => `${i + 1}. ${displayName(row)} — ${row.count}`)
    .join("\n");

  const text = `Статистика чата ${rangeLabels[range]}:\n\n${list}\n\nВсего: ${totals.messages} сообщений от ${totals.users} пользователей`;
  await redis.setex(cacheKey, TTL, text);
  return text;
}

async function buildUserStatsText(
  chatId: number,
  userId: number,
  range: RangeId
) {
  const from = getRangeStart(range);
  const cacheKey = `stats:user:${chatId}:${userId}:${range}`;
  const cached = await redis.get(cacheKey);
  if (cached) return cached;

  const count = await userMessageCount(chatId, userId, from);
  const totals = await chatTotals(chatId, from);
  const rankInfo = await userRank(chatId, userId, from);

  const rankText = rankInfo.rank
    ? `${rankInfo.rank} из ${rankInfo.totalUsers}`
    : "нет в статистике";

  const text = `Статистика пользователя ${rangeLabels[range]}:\n\nСообщений: ${count}\nМесто в чате: ${rankText}\nВсего сообщений в чате: ${totals.messages}`;
  await redis.setex(cacheKey, TTL, text);
  return text;
}

async function sendOrEdit(
  ctx: Context,
  text: string,
  keyboard?: { reply_markup?: unknown }
) {
  const markup = keyboard ? keyboard.reply_markup ?? keyboard : undefined;
  if (ctx.update?.callback_query?.message) {
    return ctx.editMessageText(text, { reply_markup: markup });
  }
  return ctx.reply(text, { reply_markup: markup });
}

async function withErrorReply(
  ctx: Context,
  action: () => Promise<unknown>
) {
  try {
    await action();
  } catch (err) {
    console.error("Handler error:", err);
    if (ctx.reply) {
      await ctx.reply("Ошибка при обработке запроса. Попробуйте позже.");
    }
  }
}

function getChatId(ctx: Context): number | null {
  return ctx.chat?.id ?? ctx.callbackQuery?.message?.chat?.id ?? null;
}

async function invalidateStatsCache(chatId: number) {
  const patterns = [`stats:top:${chatId}:*`, `stats:user:${chatId}:*`];
  for (const pattern of patterns) {
    let cursor = "0";
    do {
      const [nextCursor, keys] = await redis.scan(
        cursor,
        "MATCH",
        pattern,
        "COUNT",
        "100"
      );
      cursor = nextCursor;
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    } while (cursor !== "0");
  }
}

bot.on("text", async (ctx, next) => {
  if (!ctx.chat || ctx.chat.type === "private") {
    return next();
  }

  try {
    await upsertUser(ctx.from);
    await saveMessage(ctx.from.id, ctx.chat.id, ctx.message.text);
    await invalidateStatsCache(ctx.chat.id);
  } catch (err) {
    console.error("Failed to save message:", err);
  }

  return next();
});

bot.command("stats", async ctx => {
  await withErrorReply(ctx, async () => {
    const chatId = getChatId(ctx);
    if (!chatId) return;

    const parts = ctx.message.text.split(" ").filter(Boolean);
    const username = parts[1]?.startsWith("@") ? parts[1] : undefined;

    if (username) {
      const user = await getUserByUsername(username);
      if (!user) {
        return ctx.reply(`Пользователь ${username} не найден.`);
      }
      const text = await buildUserStatsText(chatId, user.id, "all");
      return ctx.reply(text, { reply_markup: statsKeyboard("all").reply_markup });
    }

    const text = await buildTopStatsText(chatId, "all");
    return ctx.reply(text, { reply_markup: statsKeyboard("all").reply_markup });
  });
});

bot.action(/^stats:range:(all|day|week|month)$/i, async ctx => {
  await withErrorReply(ctx, async () => {
    const chatId = getChatId(ctx);
    if (!chatId) return;

    const match = (ctx as Context & { match: RegExpMatchArray }).match;
    const range = match[1] as RangeId;
    const text = await buildTopStatsText(chatId, range);
    await ctx.answerCbQuery();
    return sendOrEdit(ctx, text, statsKeyboard(range));
  });
});

bot.action(/^stats:userlist:(all|day|week|month)$/i, async ctx => {
  await withErrorReply(ctx, async () => {
    const chatId = getChatId(ctx);
    if (!chatId) return;

    const match = (ctx as Context & { match: RegExpMatchArray }).match;
    const range = match[1] as RangeId;
    const res = await topUsers(chatId, getRangeStart(range));

    if (res.rows.length === 0) {
      await ctx.answerCbQuery();
      return sendOrEdit(
        ctx,
        `Нет данных ${rangeLabels[range]}.\n\nЕсли бот не видит сообщения, выключите Privacy Mode в BotFather.`,
        statsKeyboard(range)
      );
    }

    const userButtons = res.rows.map(row => {
      const label = displayName(row);
      return [Markup.button.callback(label, `stats:user:${row.id}:${range}`)];
    });

    const keyboard = Markup.inlineKeyboard([
      ...userButtons,
      [Markup.button.callback("Назад", `stats:range:${range}`)],
    ]);

    await ctx.answerCbQuery();
    return sendOrEdit(ctx, "Выберите пользователя:", keyboard);
  });
});

bot.action(/^stats:user:(\d+):(all|day|week|month)$/i, async ctx => {
  await withErrorReply(ctx, async () => {
    const chatId = getChatId(ctx);
    if (!chatId) return;

    const match = (ctx as Context & { match: RegExpMatchArray }).match;
    const userId = Number(match[1]);
    const range = match[2] as RangeId;
    const text = await buildUserStatsText(chatId, userId, range);

    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback("За сегодня", `stats:user:${userId}:day`),
        Markup.button.callback("За неделю", `stats:user:${userId}:week`),
        Markup.button.callback("За месяц", `stats:user:${userId}:month`),
      ],
      [Markup.button.callback("За все время", `stats:user:${userId}:all`)],
      [Markup.button.callback("К списку пользователей", `stats:userlist:${range}`)],
    ]);

    await ctx.answerCbQuery();
    return sendOrEdit(ctx, text, keyboard);
  });
});

bot.command("analyze", async ctx => {
  await withErrorReply(ctx, async () => {
    const parts = ctx.message.text.split(" ").filter(Boolean);
    const username = parts[1]?.startsWith("@") ? parts[1] : undefined;

    let userId = ctx.from.id;
    let label = formatUserLabel(ctx.from);
    const chatId = getChatId(ctx) ?? undefined;

    if (ctx.message.reply_to_message) {
      userId = ctx.message.reply_to_message.from!.id;
      label = formatUserLabel(ctx.message.reply_to_message.from!);
    }

    if (username) {
      const user = await getUserByUsername(username);
      if (!user) {
        return ctx.reply(`Пользователь ${username} не найден.`);
      }
      userId = user.id;
      label = displayName(user);
    }

    if (!username && !ctx.message.reply_to_message && ctx.chat?.type === "private") {
      return ctx.reply(
        "Для анализа в личке укажите @username или используйте reply в группе."
      );
    }

    const msgs = await messagesByUser(userId, 100, chatId);
    if (msgs.length === 0) {
      return ctx.reply(
        `Нет сообщений для анализа (${label}).\n\nЕсли бот не видит сообщения, выключите Privacy Mode в BotFather.`
      );
    }
    const result = await analyze(msgs);
    ctx.reply(`Анализ пользователя ${label}\n\n${result}`);
  });
});

bot.command("myrank", async ctx => {
  await withErrorReply(ctx, async () => {
    const chatId = getChatId(ctx);
    if (!chatId || ctx.chat?.type === "private") {
      return ctx.reply("Команда доступна только в групповых чатах.");
    }
    const info = await userRank(chatId, ctx.from.id);
    const count = await userMessageCount(chatId, ctx.from.id);
    const rankText = info.rank
      ? `${info.rank} из ${info.totalUsers}`
      : "нет в статистике";

    return ctx.reply(
      `Ваше место в чате: ${rankText}\nСообщений: ${count}`
    );
  });
});

await waitForDb().catch(err => {
  console.error("Database is not ready:", err);
  process.exit(1);
});

bot.launch().catch(err => {
  console.error("Bot launch failed:", err);
  process.exit(1);
});

console.log("Bot started");

process.on("unhandledRejection", reason => {
  console.error("Unhandled rejection:", reason);
});

process.on("uncaughtException", err => {
  console.error("Uncaught exception:", err);
  process.exit(1);
});
