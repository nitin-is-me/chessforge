-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "public"."ChatState" AS ENUM ('NONE', 'REQUESTED', 'OPEN', 'DECLINED');

-- CreateEnum
CREATE TYPE "public"."EndReason" AS ENUM ('CHECKMATE', 'RESIGNATION', 'TIMEOUT', 'STALEMATE', 'INSUFFICIENT_MATERIAL', 'FIFTY_MOVES', 'THREEFOLD_REPETITION', 'FIVEFOLD_REPETITION', 'AGREEMENT', 'ABORTED', 'DISCONNECT');

-- CreateEnum
CREATE TYPE "public"."FriendshipStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "public"."GameResult" AS ENUM ('WHITE', 'BLACK', 'DRAW');

-- CreateEnum
CREATE TYPE "public"."GameStatus" AS ENUM ('WAITING', 'STARTED', 'FINISHED', 'ABORTED');

-- CreateEnum
CREATE TYPE "public"."OpponentType" AS ENUM ('HUMAN', 'COMPUTER');

-- CreateEnum
CREATE TYPE "public"."TimeCategory" AS ENUM ('BULLET', 'BLITZ', 'RAPID', 'CLASSICAL');

-- CreateTable
CREATE TABLE "public"."ChatLink" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "state" "public"."ChatState" NOT NULL DEFAULT 'NONE',
    "requestedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Friendship" (
    "id" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "addresseeId" TEXT NOT NULL,
    "status" "public"."FriendshipStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Friendship_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Game" (
    "id" TEXT NOT NULL,
    "status" "public"."GameStatus" NOT NULL DEFAULT 'WAITING',
    "rated" BOOLEAN NOT NULL DEFAULT false,
    "category" "public"."TimeCategory" NOT NULL,
    "baseSec" INTEGER NOT NULL,
    "incSec" INTEGER NOT NULL,
    "opponent" "public"."OpponentType" NOT NULL DEFAULT 'HUMAN',
    "engineLevel" INTEGER,
    "whiteId" TEXT,
    "blackId" TEXT,
    "whiteName" TEXT,
    "blackName" TEXT,
    "whiteRating" DOUBLE PRECISION,
    "blackRating" DOUBLE PRECISION,
    "whiteRatingAfter" DOUBLE PRECISION,
    "blackRatingAfter" DOUBLE PRECISION,
    "result" "public"."GameResult",
    "reason" "public"."EndReason",
    "fen" TEXT NOT NULL,
    "pgn" TEXT,
    "plyCount" INTEGER NOT NULL DEFAULT 0,
    "whiteMs" INTEGER NOT NULL,
    "blackMs" INTEGER NOT NULL,
    "turn" TEXT NOT NULL DEFAULT 'w',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "Game_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Message" (
    "id" TEXT NOT NULL,
    "chatLinkId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Move" (
    "gameId" TEXT NOT NULL,
    "ply" INTEGER NOT NULL,
    "uci" TEXT NOT NULL,
    "san" TEXT NOT NULL,
    "chargedMs" INTEGER NOT NULL,
    "clockAfterMs" INTEGER NOT NULL,
    "lagCompMs" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Move_pkey" PRIMARY KEY ("gameId","ply")
);

-- CreateTable
CREATE TABLE "public"."Rating" (
    "userId" TEXT NOT NULL,
    "category" "public"."TimeCategory" NOT NULL,
    "rating" DOUBLE PRECISION NOT NULL DEFAULT 1500,
    "rd" DOUBLE PRECISION NOT NULL DEFAULT 350,
    "volatility" DOUBLE PRECISION NOT NULL DEFAULT 0.06,
    "games" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Rating_pkey" PRIMARY KEY ("userId","category")
);

-- CreateTable
CREATE TABLE "public"."RatingChange" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "gameId" TEXT,
    "category" "public"."TimeCategory" NOT NULL,
    "before" DOUBLE PRECISION NOT NULL,
    "after" DOUBLE PRECISION NOT NULL,
    "delta" DOUBLE PRECISION NOT NULL,
    "rdAfter" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RatingChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Report" (
    "id" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "reportedId" TEXT NOT NULL,
    "gameId" TEXT,
    "reason" TEXT NOT NULL,
    "snapshot" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "userAgent" TEXT,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."User" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "usernameLower" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "isGuest" BOOLEAN NOT NULL DEFAULT false,
    "passwordHash" TEXT,
    "email" TEXT,
    "skill" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    "settings" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ChatLink_gameId_key" ON "public"."ChatLink"("gameId" ASC);

-- CreateIndex
CREATE INDEX "Friendship_addresseeId_status_idx" ON "public"."Friendship"("addresseeId" ASC, "status" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Friendship_requesterId_addresseeId_key" ON "public"."Friendship"("requesterId" ASC, "addresseeId" ASC);

-- CreateIndex
CREATE INDEX "Game_blackId_startedAt_idx" ON "public"."Game"("blackId" ASC, "startedAt" ASC);

-- CreateIndex
CREATE INDEX "Game_status_idx" ON "public"."Game"("status" ASC);

-- CreateIndex
CREATE INDEX "Game_whiteId_startedAt_idx" ON "public"."Game"("whiteId" ASC, "startedAt" ASC);

-- CreateIndex
CREATE INDEX "Message_chatLinkId_createdAt_idx" ON "public"."Message"("chatLinkId" ASC, "createdAt" ASC);

-- CreateIndex
CREATE INDEX "Rating_category_rating_idx" ON "public"."Rating"("category" ASC, "rating" ASC);

-- CreateIndex
CREATE INDEX "RatingChange_userId_createdAt_idx" ON "public"."RatingChange"("userId" ASC, "createdAt" ASC);

-- CreateIndex
CREATE INDEX "Report_status_createdAt_idx" ON "public"."Report"("status" ASC, "createdAt" ASC);

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "public"."Session"("expiresAt" ASC);

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "public"."Session"("userId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "public"."User"("email" ASC);

-- CreateIndex
CREATE INDEX "User_lastSeenAt_idx" ON "public"."User"("lastSeenAt" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "User_usernameLower_key" ON "public"."User"("usernameLower" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "public"."User"("username" ASC);

-- AddForeignKey
ALTER TABLE "public"."ChatLink" ADD CONSTRAINT "ChatLink_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "public"."Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Friendship" ADD CONSTRAINT "Friendship_addresseeId_fkey" FOREIGN KEY ("addresseeId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Friendship" ADD CONSTRAINT "Friendship_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Game" ADD CONSTRAINT "Game_blackId_fkey" FOREIGN KEY ("blackId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Game" ADD CONSTRAINT "Game_whiteId_fkey" FOREIGN KEY ("whiteId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Message" ADD CONSTRAINT "Message_chatLinkId_fkey" FOREIGN KEY ("chatLinkId") REFERENCES "public"."ChatLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Message" ADD CONSTRAINT "Message_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Move" ADD CONSTRAINT "Move_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "public"."Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Rating" ADD CONSTRAINT "Rating_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RatingChange" ADD CONSTRAINT "RatingChange_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Report" ADD CONSTRAINT "Report_reportedId_fkey" FOREIGN KEY ("reportedId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Report" ADD CONSTRAINT "Report_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

