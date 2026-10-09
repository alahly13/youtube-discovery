import { z } from "zod";
import {
  USER_PLAYLIST_MANIFEST_TYPE,
  USER_PLAYLIST_MANIFEST_VERSION,
} from "@/types/library";

/**
 * Zod contracts for user-playlist API routes. Server-side validation only —
 * never trust client-supplied manifests without parsing here first.
 * No secrets are accepted or echoed by these schemas.
 */

const youtubeKindSchema = z.enum([
  "video",
  "shorts",
  "youtube_playlist",
  "channel",
]);

const youtubeSnapshotSchema = z.object({
  platformItemId: z.string().min(1).max(128),
  title: z.string().min(1).max(500),
  description: z.string().max(15000).nullable(),
  thumbnailUrl: z.string().max(2000).nullable(),
  channelId: z.string().max(128).nullable(),
  channelTitle: z.string().max(300).nullable(),
  publishedAt: z.string().max(64).nullable(),
  viewsCount: z.number().nullable(),
  likesCount: z.number().nullable(),
  commentsCount: z.number().nullable(),
  durationSeconds: z.number().nullable(),
  itemCount: z.number().nullable(),
  url: z.string().max(2000),
  sourceItemType: z.string().max(64),
  isShortsLike: z.boolean(),
  isAgeRestricted: z.boolean().optional(),
});

const baseMembershipSchema = z.object({
  entryId: z.string().min(1).max(160),
  position: z.number().int().min(0).max(100000),
  groupId: z.string().max(160).nullable(),
  addedAt: z.string().min(1).max(64),
  updatedAt: z.string().min(1).max(64),
  note: z.string().max(8000).nullable(),
});

const youtubeItemSchema = baseMembershipSchema.extend({
  kind: z.literal("youtube"),
  youtubeKind: youtubeKindSchema,
  snapshot: youtubeSnapshotSchema,
});

const customItemSchema = baseMembershipSchema.extend({
  kind: z.literal("custom"),
  title: z.string().min(1).max(300),
  customNote: z.string().max(8000).nullable(),
  url: z.string().max(2000).nullable(),
});

const playlistItemSchema = z.union([youtubeItemSchema, customItemSchema]);

const playlistGroupSchema = z.object({
  id: z.string().min(1).max(160),
  title: z.string().min(1).max(200),
  description: z.string().max(8000).nullable(),
  position: z.number().int().min(0).max(100000),
  createdAt: z.string().min(1).max(64),
  updatedAt: z.string().min(1).max(64),
});

export const userPlaylistManifestSchema = z.object({
  manifestVersion: z.literal(USER_PLAYLIST_MANIFEST_VERSION),
  type: z.literal(USER_PLAYLIST_MANIFEST_TYPE),
  playlist: z.object({
    id: z.string().min(1).max(160),
    name: z.string().min(1).max(200),
    description: z.string().max(8000).nullable(),
    createdAt: z.string().min(1).max(64),
    updatedAt: z.string().min(1).max(64),
  }),
  groups: z.array(playlistGroupSchema).max(500),
  items: z.array(playlistItemSchema).max(5000),
});

export const createPlaylistSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(8000).nullable().optional(),
});

export const updatePlaylistMetaSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(8000).nullable().optional(),
});

export type ValidatedUserPlaylistManifest = z.infer<
  typeof userPlaylistManifestSchema
>;
