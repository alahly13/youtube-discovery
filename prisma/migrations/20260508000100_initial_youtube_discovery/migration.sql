-- Initial canonical schema for youtube-discovery.
-- The migration is intentionally additive: it creates the modern manifest,
-- YouTube metadata, persistence, AI, fetch-job, and quota tables without
-- assuming any legacy tables exist in this new repository.

CREATE TYPE "Platform" AS ENUM ('YOUTUBE');
CREATE TYPE "YouTubeItemType" AS ENUM ('VIDEO', 'SHORTS_LIKE', 'CHANNEL', 'PLAYLIST', 'LIVE', 'UPCOMING', 'COMPLETED_LIVE', 'POST_UNSUPPORTED');
CREATE TYPE "VideoSourceType" AS ENUM ('SEARCH', 'CHANNEL', 'PLAYLIST', 'LINK', 'COLLECTION', 'RELATED');
CREATE TYPE "ManifestType" AS ENUM ('YOUTUBE_SEARCH', 'YOUTUBE_CHANNEL_UPLOADS', 'YOUTUBE_PLAYLIST', 'YOUTUBE_RELATED_VIDEOS', 'YOUTUBE_SAVED_COLLECTION', 'YOUTUBE_AI_RESULT_SET', 'YOUTUBE_LINK_EXPLORER');
CREATE TYPE "ManifestStatus" AS ENUM ('DRAFT', 'RUNNING', 'COMPLETE', 'PARTIAL', 'FAILED', 'STOPPED', 'MAX_ITEMS_REACHED', 'QUOTA_LIMITED', 'PROVIDER_LIMITED', 'EXPIRED');
CREATE TYPE "FetchJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETE', 'PARTIAL', 'FAILED', 'STOPPED', 'QUOTA_LIMITED');
CREATE TYPE "AiScopeType" AS ENUM ('SEARCH_MANIFEST', 'CHANNEL_UPLOADS_MANIFEST', 'PLAYLIST_MANIFEST', 'LINK_EXPLORER_MANIFEST', 'SAVED_LIBRARY', 'COLLECTION', 'SELECTED_VIDEO');

CREATE TABLE "VideoSource" (
  "id" TEXT NOT NULL,
  "platform" "Platform" NOT NULL DEFAULT 'YOUTUBE',
  "sourceType" "VideoSourceType" NOT NULL,
  "externalSourceId" TEXT NOT NULL,
  "title" TEXT,
  "canonicalUrl" TEXT,
  "rawJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "VideoSource_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "YouTubeVideo" (
  "id" TEXT NOT NULL,
  "platform" "Platform" NOT NULL DEFAULT 'YOUTUBE',
  "platformVideoId" TEXT NOT NULL,
  "canonicalUrl" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "thumbnailUrl" TEXT,
  "channelId" TEXT,
  "channelTitle" TEXT,
  "publishedAt" TIMESTAMP(3),
  "durationSeconds" INTEGER,
  "viewsCount" BIGINT,
  "likesCount" BIGINT,
  "commentsCount" BIGINT,
  "language" TEXT,
  "region" TEXT,
  "categoryId" TEXT,
  "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "isEmbeddable" BOOLEAN,
  "liveBroadcastContent" TEXT,
  "isShortsLike" BOOLEAN NOT NULL DEFAULT false,
  "rawJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "YouTubeVideo_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "YouTubeChannel" (
  "id" TEXT NOT NULL,
  "platform" "Platform" NOT NULL DEFAULT 'YOUTUBE',
  "platformChannelId" TEXT NOT NULL,
  "handle" TEXT,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "thumbnailUrl" TEXT,
  "uploadsPlaylistId" TEXT,
  "publishedAt" TIMESTAMP(3),
  "subscriberCount" BIGINT,
  "videoCount" BIGINT,
  "viewCount" BIGINT,
  "rawJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "YouTubeChannel_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "YouTubePlaylist" (
  "id" TEXT NOT NULL,
  "platform" "Platform" NOT NULL DEFAULT 'YOUTUBE',
  "platformPlaylistId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "thumbnailUrl" TEXT,
  "channelId" TEXT,
  "channelTitle" TEXT,
  "publishedAt" TIMESTAMP(3),
  "itemCount" INTEGER,
  "rawJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "YouTubePlaylist_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Manifest" (
  "id" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL DEFAULT 'local',
  "manifestType" "ManifestType" NOT NULL,
  "platform" "Platform" NOT NULL DEFAULT 'YOUTUBE',
  "title" TEXT NOT NULL,
  "query" TEXT,
  "sourceId" TEXT,
  "searchSettingsSnapshot" JSONB,
  "pagesFetched" INTEGER NOT NULL DEFAULT 0,
  "nextPageToken" TEXT,
  "quotaCostEstimate" INTEGER NOT NULL DEFAULT 0,
  "status" "ManifestStatus" NOT NULL DEFAULT 'DRAFT',
  "itemCount" INTEGER NOT NULL DEFAULT 0,
  "duplicateCount" INTEGER NOT NULL DEFAULT 0,
  "warnings" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "errors" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "collectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Manifest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ManifestItem" (
  "id" TEXT NOT NULL,
  "manifestId" TEXT NOT NULL,
  "itemType" "YouTubeItemType" NOT NULL,
  "platformItemId" TEXT NOT NULL,
  "position" INTEGER,
  "playlistPosition" INTEGER,
  "sourcePage" INTEGER,
  "sourcePageToken" TEXT,
  "title" TEXT NOT NULL,
  "canonicalUrl" TEXT,
  "videoId" TEXT,
  "channelRecordId" TEXT,
  "playlistRecordId" TEXT,
  "normalizedJson" JSONB NOT NULL,
  "rawJson" JSONB,
  "collectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ManifestItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SavedVideo" (
  "id" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL DEFAULT 'local',
  "videoId" TEXT NOT NULL,
  "notes" TEXT,
  "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SavedVideo_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Collection" (
  "id" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL DEFAULT 'local',
  "title" TEXT NOT NULL,
  "description" TEXT,
  "itemCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Collection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SearchJob" (
  "id" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL DEFAULT 'local',
  "manifestId" TEXT,
  "status" "FetchJobStatus" NOT NULL DEFAULT 'QUEUED',
  "settings" JSONB NOT NULL,
  "startedAt" TIMESTAMP(3),
  "finishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SearchJob_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FetchJob" (
  "id" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL DEFAULT 'local',
  "sourceId" TEXT,
  "manifestId" TEXT,
  "status" "FetchJobStatus" NOT NULL DEFAULT 'QUEUED',
  "sourceKind" "VideoSourceType" NOT NULL,
  "cursor" TEXT,
  "maxItems" INTEGER,
  "startedAt" TIMESTAMP(3),
  "finishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FetchJob_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FetchPageAttempt" (
  "id" TEXT NOT NULL,
  "fetchJobId" TEXT NOT NULL,
  "pageToken" TEXT,
  "pageNumber" INTEGER NOT NULL,
  "providerMethod" TEXT NOT NULL,
  "quotaCost" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL,
  "itemCount" INTEGER NOT NULL DEFAULT 0,
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),
  CONSTRAINT "FetchPageAttempt_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FetchJobEvent" (
  "id" TEXT NOT NULL,
  "fetchJobId" TEXT NOT NULL,
  "level" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "meta" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FetchJobEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProviderRequestLog" (
  "id" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL DEFAULT 'local',
  "platform" "Platform" NOT NULL DEFAULT 'YOUTUBE',
  "operation" TEXT NOT NULL,
  "quotaCost" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL,
  "requestSummary" JSONB,
  "responseSummary" JSONB,
  "errorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProviderRequestLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "QuotaUsageEvent" (
  "id" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL DEFAULT 'local',
  "platform" "Platform" NOT NULL DEFAULT 'YOUTUBE',
  "operation" TEXT NOT NULL,
  "units" INTEGER NOT NULL,
  "manifestId" TEXT,
  "sourceId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "QuotaUsageEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiSession" (
  "id" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL DEFAULT 'local',
  "scopeType" "AiScopeType" NOT NULL,
  "manifestId" TEXT,
  "selectedVideoId" TEXT,
  "model" TEXT NOT NULL,
  "prompt" TEXT NOT NULL,
  "responseJson" JSONB,
  "evidenceRefs" JSONB,
  "itemCountUsed" INTEGER NOT NULL DEFAULT 0,
  "charCountUsed" INTEGER NOT NULL DEFAULT 0,
  "safetyStatus" TEXT NOT NULL DEFAULT 'scoped',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VideoSource_platform_sourceType_externalSourceId_key" ON "VideoSource"("platform", "sourceType", "externalSourceId");
CREATE INDEX "VideoSource_sourceType_updatedAt_idx" ON "VideoSource"("sourceType", "updatedAt");
CREATE UNIQUE INDEX "YouTubeVideo_canonicalUrl_key" ON "YouTubeVideo"("canonicalUrl");
CREATE UNIQUE INDEX "YouTubeVideo_platform_platformVideoId_key" ON "YouTubeVideo"("platform", "platformVideoId");
CREATE INDEX "YouTubeVideo_channelId_publishedAt_idx" ON "YouTubeVideo"("channelId", "publishedAt");
CREATE INDEX "YouTubeVideo_isShortsLike_idx" ON "YouTubeVideo"("isShortsLike");
CREATE UNIQUE INDEX "YouTubeChannel_platform_platformChannelId_key" ON "YouTubeChannel"("platform", "platformChannelId");
CREATE INDEX "YouTubeChannel_handle_idx" ON "YouTubeChannel"("handle");
CREATE UNIQUE INDEX "YouTubePlaylist_platform_platformPlaylistId_key" ON "YouTubePlaylist"("platform", "platformPlaylistId");
CREATE INDEX "YouTubePlaylist_channelId_idx" ON "YouTubePlaylist"("channelId");
CREATE INDEX "Manifest_ownerId_updatedAt_idx" ON "Manifest"("ownerId", "updatedAt");
CREATE INDEX "Manifest_manifestType_status_idx" ON "Manifest"("manifestType", "status");
CREATE UNIQUE INDEX "ManifestItem_manifestId_itemType_platformItemId_key" ON "ManifestItem"("manifestId", "itemType", "platformItemId");
CREATE INDEX "ManifestItem_manifestId_position_idx" ON "ManifestItem"("manifestId", "position");
CREATE INDEX "ManifestItem_platformItemId_idx" ON "ManifestItem"("platformItemId");
CREATE UNIQUE INDEX "SavedVideo_ownerId_videoId_key" ON "SavedVideo"("ownerId", "videoId");
CREATE INDEX "SavedVideo_ownerId_createdAt_idx" ON "SavedVideo"("ownerId", "createdAt");
CREATE INDEX "Collection_ownerId_updatedAt_idx" ON "Collection"("ownerId", "updatedAt");
CREATE INDEX "FetchJob_ownerId_status_updatedAt_idx" ON "FetchJob"("ownerId", "status", "updatedAt");
CREATE INDEX "FetchJob_sourceId_updatedAt_idx" ON "FetchJob"("sourceId", "updatedAt");
CREATE INDEX "FetchPageAttempt_fetchJobId_pageNumber_idx" ON "FetchPageAttempt"("fetchJobId", "pageNumber");
CREATE INDEX "FetchJobEvent_fetchJobId_createdAt_idx" ON "FetchJobEvent"("fetchJobId", "createdAt");
CREATE INDEX "ProviderRequestLog_ownerId_createdAt_idx" ON "ProviderRequestLog"("ownerId", "createdAt");
CREATE INDEX "ProviderRequestLog_platform_operation_createdAt_idx" ON "ProviderRequestLog"("platform", "operation", "createdAt");
CREATE INDEX "QuotaUsageEvent_ownerId_createdAt_idx" ON "QuotaUsageEvent"("ownerId", "createdAt");
CREATE INDEX "QuotaUsageEvent_platform_operation_createdAt_idx" ON "QuotaUsageEvent"("platform", "operation", "createdAt");
CREATE INDEX "AiSession_ownerId_createdAt_idx" ON "AiSession"("ownerId", "createdAt");
CREATE INDEX "AiSession_scopeType_createdAt_idx" ON "AiSession"("scopeType", "createdAt");

ALTER TABLE "Manifest" ADD CONSTRAINT "Manifest_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "VideoSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ManifestItem" ADD CONSTRAINT "ManifestItem_manifestId_fkey" FOREIGN KEY ("manifestId") REFERENCES "Manifest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ManifestItem" ADD CONSTRAINT "ManifestItem_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "YouTubeVideo"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ManifestItem" ADD CONSTRAINT "ManifestItem_channelRecordId_fkey" FOREIGN KEY ("channelRecordId") REFERENCES "YouTubeChannel"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ManifestItem" ADD CONSTRAINT "ManifestItem_playlistRecordId_fkey" FOREIGN KEY ("playlistRecordId") REFERENCES "YouTubePlaylist"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SavedVideo" ADD CONSTRAINT "SavedVideo_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "YouTubeVideo"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SearchJob" ADD CONSTRAINT "SearchJob_manifestId_fkey" FOREIGN KEY ("manifestId") REFERENCES "Manifest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FetchJob" ADD CONSTRAINT "FetchJob_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "VideoSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FetchJob" ADD CONSTRAINT "FetchJob_manifestId_fkey" FOREIGN KEY ("manifestId") REFERENCES "Manifest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FetchPageAttempt" ADD CONSTRAINT "FetchPageAttempt_fetchJobId_fkey" FOREIGN KEY ("fetchJobId") REFERENCES "FetchJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FetchJobEvent" ADD CONSTRAINT "FetchJobEvent_fetchJobId_fkey" FOREIGN KEY ("fetchJobId") REFERENCES "FetchJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiSession" ADD CONSTRAINT "AiSession_manifestId_fkey" FOREIGN KEY ("manifestId") REFERENCES "Manifest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
