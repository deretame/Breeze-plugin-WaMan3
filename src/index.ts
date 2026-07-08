import type {
  ActionItem,
  AdvancedSearchContract,
  CapabilitiesBundleContract,
  ChapterContentContract,
  ChapterPage,
  ChapterPayload,
  ChapterSummary,
  ComicDetailContract,
  ComicDetailNormal,
  ComicDetailPayload,
  ComicListSceneBundleContract,
  ComicPagedListContract,
  CommentFeedContract,
  CommentFeedPayload,
  CommentItem,
  CommentMutationContract,
  CommentPostPayload,
  CommentRepliesContract,
  CommentRepliesPayload,
  CommentReplyPayload,
  FetchImageBytesPayload,
  FilterBundleContract,
  FunctionPageContract,
  GetFunctionPagePayload,
  InfoContract,
  ListFavoriteFoldersResult,
  MetadataListItem,
  MoveFavoriteToFolderPayload,
  ReadSnapshotContract,
  ReadSnapshotPayload,
  SearchComicPayload,
  SearchResultContract,
  SettingsBundleContract,
  StringMap,
  ToggleFavoritePayload,
  ToggleFavoriteResult,
  ToggleLikePayload,
  ToggleLikeResult,
  UserInfoBundleContract,
} from "breeze-plugin-kit";
import { getResponseData, init, manwaApi } from "./api";
import {
  NOT_FOUND_IMAGE_URL,
  PLUGIN_ID,
  createActionItem,
  createBasicMetadata,
  createImage,
  createMetadataActionList,
  toStringMap,
} from "./common";
import { imageDecrypt } from "./crypto";
import { buildPluginInfo } from "./get-info";

// ---------------------------------------------------------------------------
// Manwa3 API 原始类型
// ---------------------------------------------------------------------------

type ManwaSearchItem = {
  id: number;
  name: string;
  pic: string;
  picx: string;
  text: string;
  hits: string;
  serialize: string;
  cid: string;
  lv: number;
  author: string;
};

type ManwaSearchData = {
  list: ManwaSearchItem[];
  nums: number;
  size: number;
  ads?: unknown;
};

type ManwaTag = { name: string };

type ManwaChapter = {
  id: number;
  name: string;
  vip: number;
  addtime: string;
  picx: string;
  sort: number;
  readed: number;
  is_vip: number;
  lv: number;
};

type ManwaDetailData = {
  id: string;
  name: string;
  book_area: string;
  area_id: number;
  category_name: string;
  cid: number;
  nickname: string;
  tags: ManwaTag[];
  picx: string;
  author: string[] | string;
  state: string;
  score: number;
  hits: string;
  shits: number;
  text: string;
  nums: number;
  addtime: string;
  last_time: string;
  end: number;
  fav: number;
  chapter_list: ManwaChapter[];
  full_book_id: number;
  full_chapter_list: unknown[];
  love_list: unknown[];
};

type ManwaPic = { pic: string };

type ManwaChapterData = {
  id: number;
  name: string;
  state: string;
  is_pay: number;
  img_host: number;
  _CURRENT_IMG_DOMAIN: string;
  _ALL_IMG_DOMAINS: string[];
  piclist: ManwaPic[];
};

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function createSearchActionItem(name: string): ActionItem {
  return createActionItem(name, {
    type: "openSearch",
    payload: {
      source: PLUGIN_ID,
      keyword: name,
      extern: {},
    },
  });
}

function parseAuthors(input: string | string[] | undefined | null): string[] {
  if (!input) return [];
  if (Array.isArray(input))
    return input.map((s) => String(s).trim()).filter(Boolean);
  return String(input)
    .split("###")
    .map((s) => s.trim())
    .filter(Boolean);
}

function buildCoverImage(
  comicId: string,
  url: string,
): ReturnType<typeof createImage> {
  const path = `comic/${comicId}/cover.webp`;
  return createImage({
    id: comicId,
    url: url || NOT_FOUND_IMAGE_URL,
    name: "cover.webp",
    path,
    extern: { path },
  });
}

function buildSearchItem(raw: ManwaSearchItem) {
  const id = String(raw.id);
  const authors = parseAuthors(raw.author);
  return {
    source: PLUGIN_ID,
    id,
    title: String(raw.name ?? ""),
    subtitle: String(raw.text ?? ""),
    finished: String(raw.serialize ?? "").includes("完结"),
    likesCount: 0,
    viewsCount: Number(raw.hits ?? 0),
    updatedAt: "",
    cover: buildCoverImage(id, raw.picx || raw.pic),
    metadata: [
      createBasicMetadata("author", "作者", authors),
      createBasicMetadata(
        "categories",
        "分类",
        [raw.serialize].filter(Boolean),
      ),
    ],
    raw: raw as unknown as StringMap,
    extern: {},
  };
}

function buildChapterSummary(raw: ManwaChapter): ChapterSummary {
  const id = String(raw.id);
  return {
    id,
    requestId: id,
    logicalKey: id,
    storageChapterId: id,
    name: String(raw.name ?? ""),
    order: Number(raw.sort ?? 0),
    extern: {},
  };
}

function buildChapterPages(
  comicId: string,
  chapterId: string,
  piclist: ManwaPic[],
): ChapterPage[] {
  return piclist.map((pic, index) => {
    const url = String(pic.pic ?? "");
    const fileName = `${index + 1}.webp`;
    const path = `comic/${comicId}/${chapterId}/${fileName}`;
    return {
      id: `${chapterId}-p-${index + 1}`,
      name: fileName,
      path,
      url: url || NOT_FOUND_IMAGE_URL,
      extern: { needsDecrypt: true },
    };
  });
}

// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

const PAGE_SIZE = 20;

// ---------------------------------------------------------------------------
// getInfo — 插件注册信息
// ---------------------------------------------------------------------------

async function getInfo(): Promise<InfoContract> {
  return buildPluginInfo() as InfoContract;
}

// ---------------------------------------------------------------------------
// searchComic — 搜索漫画
// ---------------------------------------------------------------------------

async function searchComic(
  payload: SearchComicPayload = {},
): Promise<SearchResultContract> {
  const extern = toStringMap(payload.extern);
  const page = Math.max(1, Number(payload.page ?? 1) || 1);
  const keyword =
    String(payload.keyword ?? extern.keyword ?? "1").trim() || "1";

  const response = await manwaApi.get("/api/search/index", {
    params: { k: keyword, page },
  });
  console.log(response.data);
  const data = getResponseData<ManwaSearchData>(response);
  const items = data.list.map(buildSearchItem);
  const total = Number(data.nums ?? items.length);
  const paging = {
    page,
    pages: page + 1,
    total,
    hasReachedMax: false,
  };

  return {
    source: PLUGIN_ID,
    extern: payload.extern ?? null,
    scheme: {
      version: "1.0.0" as const,
      type: "searchResult" as const,
      source: PLUGIN_ID,
      list: "comicGrid",
    },
    data: { paging, items },
    paging,
    items,
  };
}

// ---------------------------------------------------------------------------
// getComicDetail — 漫画详情
// ---------------------------------------------------------------------------

async function getComicDetail(
  payload: ComicDetailPayload = {},
): Promise<ComicDetailContract> {
  const comicId = String(payload.comicId ?? "").trim();
  if (!comicId) throw new Error("comicId 不能为空");

  const response = await manwaApi.get("/api/detail/index", {
    params: { id: comicId },
  });
  const raw = getResponseData<ManwaDetailData>(response);

  const authors = parseAuthors(raw.author);
  const tags = Array.isArray(raw.tags)
    ? raw.tags.map((t) => String(t.name ?? "")).filter(Boolean)
    : [];
  const chapters = Array.isArray(raw.chapter_list)
    ? raw.chapter_list.map(buildChapterSummary)
    : [];

  const normal: ComicDetailNormal = {
    comicInfo: {
      id: comicId,
      title: String(raw.name ?? ""),
      titleMeta: [
        { label: "浏览", value: raw.hits },
        { label: "章节数", value: chapters.length },
        { label: "状态", value: raw.state },
        { label: "评分", value: raw.score },
        { label: "地区", value: raw.book_area },
        { label: "分类", value: raw.category_name },
        { label: "更新", value: raw.last_time },
      ]
        .filter(
          (item) =>
            item.value !== undefined &&
            item.value !== null &&
            String(item.value) !== "",
        )
        .map((item) => createActionItem(`${item.label}：${item.value}`)),
      creator: {
        id: "",
        name: "",
        avatar: createImage({
          id: "",
          url: "",
          name: "",
          path: "",
          extern: {},
        }),
        onTap: {},
        extern: {},
      },
      description: String(raw.text ?? ""),
      cover: buildCoverImage(comicId, raw.picx),
      metadata: [
        createMetadataActionList(
          "author",
          "作者",
          authors,
          createSearchActionItem,
        ),
        createMetadataActionList("tags", "标签", tags, createSearchActionItem),
      ].filter((m): m is MetadataListItem => m.value.length > 0),
      extern: {},
    },
    eps: chapters,
    recommend: [],
    totalViews: Number(raw.hits ?? 0),
    totalLikes: Number(raw.shits ?? 0),
    totalComments: 0,
    isFavourite: false,
    isLiked: false,
    allowComments: false,
    allowLike: false,
    allowCollected: false,
    allowDownload: true,
    extern: {},
  };

  return {
    source: PLUGIN_ID,
    comicId,
    extern: payload.extern ?? null,
    scheme: {
      version: "1.0.0" as const,
      type: "comicDetail" as const,
      source: PLUGIN_ID,
    },
    data: {
      normal,
      raw: raw as unknown as StringMap,
    },
  };
}

// ---------------------------------------------------------------------------
// getChapter — 章节内容（下载场景）
// ---------------------------------------------------------------------------

async function getChapter(
  payload: ChapterPayload = {},
): Promise<ChapterContentContract> {
  const comicId = String(payload.comicId ?? "").trim();
  if (!comicId) throw new Error("comicId 不能为空");

  const chapterId = String(payload.chapterId ?? "").trim();
  if (!chapterId) throw new Error("chapterId 不能为空");

  const response = await manwaApi.get("/api/chapters/index", {
    params: { id: chapterId, img_host: 0 },
  });
  const raw = getResponseData<ManwaChapterData>(response);
  const pages = buildChapterPages(comicId, chapterId, raw.piclist ?? []);

  const chapterSummary = buildChapterSummary({
    id: Number(chapterId),
    name: raw.name ?? "",
    vip: raw.is_pay ?? 0,
    addtime: "",
    picx: "",
    sort: 0,
    readed: 0,
    is_vip: raw.is_pay ?? 0,
    lv: 0,
  });

  return {
    source: PLUGIN_ID,
    comicId,
    chapterId,
    extern: payload.extern ?? null,
    scheme: {
      version: "1.0.0" as const,
      type: "chapterContent" as const,
      source: PLUGIN_ID,
    },
    data: {
      comic: {
        id: comicId,
        source: PLUGIN_ID,
        title: String(raw.name ?? ""),
        extern: {},
      },
      chapter: {
        ...chapterSummary,
        pages,
      },
      chapters: [chapterSummary],
    },
  };
}

// ---------------------------------------------------------------------------
// getReadSnapshot — 阅读快照（在线阅读用）
// ---------------------------------------------------------------------------

async function getReadSnapshot(
  payload: ReadSnapshotPayload = {},
): Promise<ReadSnapshotContract> {
  const comicId = String(payload.comicId ?? "").trim();
  if (!comicId) throw new Error("comicId 不能为空");
  const chapterId = String(payload.chapterId ?? "").trim();
  if (!chapterId) throw new Error("该漫画无可阅读章节");

  const [detail, chapterContent] = await Promise.all([
    getComicDetail({ comicId, extern: payload.extern }),
    getChapter({
      comicId,
      chapterId: payload.chapterId,
      extern: payload.extern,
    }),
  ]);

  const normal = (detail.data as { normal?: ComicDetailNormal }).normal;
  const comicInfo = normal?.comicInfo;
  const chapters = normal?.eps ?? [];

  return {
    source: PLUGIN_ID,
    extern: payload.extern ?? null,
    data: {
      comic: {
        id: comicId,
        source: PLUGIN_ID,
        title: String(comicInfo?.title ?? ""),
        extern: toStringMap(comicInfo?.extern),
      },
      chapter: chapterContent.data.chapter,
      chapters: chapters.map((item) => ({
        id: String(item.id),
        name: String(item.name),
        order: Number(item.order),
        extern: item.extern,
      })),
    },
  };
}

// ---------------------------------------------------------------------------
// fetchImageBytes — 下载图片
// ---------------------------------------------------------------------------

async function fetchImageBytes({
  url = "",
  timeoutMs = 30000,
  extern = {},
}: FetchImageBytesPayload = {}): Promise<Uint8Array<ArrayBufferLike>> {
  const targetUrl = String(url).trim();
  if (!targetUrl) throw new Error("url 不能为空");

  const res = await fetch(targetUrl, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      "x-rquickjs-host-offload-binary-v1": "1",
    },
  });
  if (!res.ok) {
    throw new Error(`下载图片失败: ${res.status} ${res.statusText}`);
  }

  const bytes = new Uint8Array(await res.arrayBuffer());

  // 仅章节内图片需要解密；extern.needsDecrypt 为 true 时解密
  if (extern.needsDecrypt === true) {
    return await imageDecrypt(bytes);
  }

  return bytes;
}

// ---------------------------------------------------------------------------
// toggleLike — 点赞
// ---------------------------------------------------------------------------

async function toggleLike(
  payload: ToggleLikePayload = {},
): Promise<ToggleLikeResult> {
  void payload;
  return { liked: false };
}

// ---------------------------------------------------------------------------
// toggleFavorite — 收藏
// ---------------------------------------------------------------------------

async function toggleFavorite(
  payload: ToggleFavoritePayload = {},
): Promise<ToggleFavoriteResult> {
  void payload;
  return { favorited: false, nextStep: "none" };
}

// ---------------------------------------------------------------------------
// listFavoriteFolders — 收藏夹列表
// ---------------------------------------------------------------------------

async function listFavoriteFolders(): Promise<ListFavoriteFoldersResult> {
  return { items: [] };
}

// ---------------------------------------------------------------------------
// moveFavoriteToFolder — 移动到收藏夹
// ---------------------------------------------------------------------------

async function moveFavoriteToFolder(
  payload: MoveFavoriteToFolderPayload = {},
): Promise<{ ok: boolean }> {
  void payload;
  return { ok: true };
}

// ---------------------------------------------------------------------------
// getAdvancedSearchScheme — 高级搜索方案
// ---------------------------------------------------------------------------

async function getAdvancedSearchScheme(
  _payload: Record<string, unknown> = {},
): Promise<AdvancedSearchContract> {
  return {
    source: PLUGIN_ID,
    scheme: {
      version: "1.0.0" as const,
      type: "advancedSearch" as const,
      title: "高级搜索",
      fields: [
        {
          key: "sortBy",
          kind: "choice" as const,
          label: "排序",
          options: [
            { label: "最新", value: "latest" },
            { label: "最热", value: "hot" },
          ],
        },
      ],
    },
    data: { values: { sortBy: "latest" } },
  };
}

// ---------------------------------------------------------------------------
// getComicListSceneBundle — 漫画列表场景
// ---------------------------------------------------------------------------

async function getComicListSceneBundle(): Promise<ComicListSceneBundleContract> {
  return {
    source: PLUGIN_ID,
    scheme: {
      version: "1.0.0" as const,
      type: "comicListSceneBundle" as const,
    },
    data: {
      scene: {
        title: "排行榜",
        source: PLUGIN_ID,
        body: {
          type: "pluginPagedComicList" as const,
          request: {
            fnPath: "getRankingData",
            core: {},
            extern: { source: "ranking" },
          },
        },
        filter: {
          fnPath: "getRankingFilterBundle",
          extern: { source: "ranking" },
        },
      },
    },
  };
}

// ---------------------------------------------------------------------------
// getRankingData — 榜单数据
// ---------------------------------------------------------------------------

async function getRankingData(
  _payload: SearchComicPayload = {},
): Promise<ComicPagedListContract> {
  const searchResult = await searchComic({
    keyword: "1",
    page: _payload.page,
    extern: _payload.extern,
  });
  return {
    source: PLUGIN_ID,
    extern: _payload.extern ?? null,
    scheme: {
      version: "1.0.0" as const,
      type: "rankingFeed" as const,
    },
    data: {
      hasReachedMax: searchResult.paging.hasReachedMax,
      items: searchResult.items,
    },
  };
}

// ---------------------------------------------------------------------------
// getRankingFilterBundle — 榜单筛选
// ---------------------------------------------------------------------------

async function getRankingFilterBundle(): Promise<FilterBundleContract> {
  return {
    source: PLUGIN_ID,
    scheme: {
      version: "1.0.0" as const,
      fields: [
        {
          key: "rankType",
          kind: "choice" as const,
          label: "榜单类型",
          options: [
            {
              label: "日榜",
              value: "day",
              result: { extern: { rankType: "day" } },
            },
            {
              label: "周榜",
              value: "week",
              result: { extern: { rankType: "week" } },
            },
            {
              label: "月榜",
              value: "month",
              result: { extern: { rankType: "month" } },
            },
          ],
        },
      ],
    },
    data: { values: { rankType: "day" } },
  };
}

// ---------------------------------------------------------------------------
// getCommentFeed — 评论列表
// ---------------------------------------------------------------------------

async function getCommentFeed(
  _payload: CommentFeedPayload = {},
): Promise<CommentFeedContract> {
  const comment: CommentItem = {
    id: "c-1",
    author: { name: "", avatar: { url: "", path: "" } },
    content: "",
    createdAt: "",
    replyCount: 0,
    replies: [],
    extern: {},
  };
  return {
    source: PLUGIN_ID,
    extern: null,
    scheme: { version: "1.0.0" as const, type: "commentFeed" as const },
    data: {
      topItems: [],
      items: [comment],
      paging: { hasReachedMax: true },
      replyMode: "lazy",
      canComment: { comic: false, reply: false },
    },
  };
}

// ---------------------------------------------------------------------------
// loadCommentReplies — 评论回复列表
// ---------------------------------------------------------------------------

async function loadCommentReplies(
  _payload: CommentRepliesPayload = {},
): Promise<CommentRepliesContract> {
  return {
    source: PLUGIN_ID,
    extern: null,
    scheme: { version: "1.0.0" as const, type: "commentReplies" as const },
    data: {
      commentId: "c-1",
      items: [],
      paging: { hasReachedMax: true },
    },
  };
}

// ---------------------------------------------------------------------------
// postComment — 发送评论
// ---------------------------------------------------------------------------

async function postComment(
  _payload: CommentPostPayload = {},
): Promise<CommentMutationContract> {
  return {
    source: PLUGIN_ID,
    scheme: { version: "1.0.0" as const, type: "commentMutation" as const },
    data: {
      ok: false,
      mode: "postComment",
      created: null,
      insertHint: { needsRefetch: true },
    },
  };
}

// ---------------------------------------------------------------------------
// postCommentReply — 回复评论
// ---------------------------------------------------------------------------

async function postCommentReply(
  _payload: CommentReplyPayload = {},
): Promise<CommentMutationContract> {
  return {
    source: PLUGIN_ID,
    scheme: { version: "1.0.0" as const, type: "commentMutation" as const },
    data: {
      ok: false,
      mode: "postReply",
      parentId: "c-1",
      created: null,
      insertHint: {
        strategy: "prepend",
        targetCommentId: "c-1",
        needsRefetch: true,
      },
    },
  };
}

// ---------------------------------------------------------------------------
// getSettingsBundle — 设置方案
// ---------------------------------------------------------------------------

async function getSettingsBundle(): Promise<SettingsBundleContract> {
  return {
    source: PLUGIN_ID,
    scheme: {
      version: "1.0.0" as const,
      type: "settings" as const,
      sections: [],
    },
    data: {
      canShowUserInfo: false,
      values: {},
    },
  };
}

// ---------------------------------------------------------------------------
// Capabilities — "操作" 区段
// ---------------------------------------------------------------------------

async function getCapabilitiesBundle(): Promise<CapabilitiesBundleContract> {
  return {
    source: PLUGIN_ID,
    scheme: {
      version: "1.0.0" as const,
      type: "capabilities" as const,
      actions: [
        { key: "clear", title: "清理插件缓存", fnPath: "clearPluginCache" },
      ],
    },
    data: {},
  };
}

// ---------------------------------------------------------------------------
// getUserInfoBundle — 用户信息卡片
// ---------------------------------------------------------------------------

async function getUserInfoBundle(): Promise<UserInfoBundleContract> {
  return {
    source: PLUGIN_ID,
    scheme: { version: "1.0.0" as const, type: "userInfo" as const },
    data: {
      title: "账号信息",
      avatar: createImage({
        id: "u-1",
        url: "",
        name: "avatar",
        path: "u/1.jpg",
        extern: {},
      }),
      lines: ["未登录"],
    },
  };
}

// ---------------------------------------------------------------------------
// getFunctionPage — 插件自定义页面
// ---------------------------------------------------------------------------

async function getFunctionPage(
  _payload: GetFunctionPagePayload = {},
): Promise<FunctionPageContract> {
  throw new Error("getFunctionPage 未实现");
}

// ---------------------------------------------------------------------------
// fnPath 回调 — 设置页字段变更时调用
// ---------------------------------------------------------------------------

async function onAuthChanged(
  payload: { key?: string; value?: unknown; allValues?: StringMap } = {},
): Promise<Record<string, unknown>> {
  void payload;
  return {};
}

async function onQualityChanged(
  payload: { key?: string; value?: unknown; allValues?: StringMap } = {},
): Promise<Record<string, unknown>> {
  void payload;
  return {};
}

async function clearPluginCache(): Promise<Record<string, unknown>> {
  return { ok: true };
}

// ---------------------------------------------------------------------------
// default export — 导出所有函数
// ---------------------------------------------------------------------------

export default {
  // lifecycle
  init,

  // core
  getInfo,
  searchComic,
  getComicDetail,
  getChapter,
  getReadSnapshot,
  fetchImageBytes,

  // social
  toggleLike,
  toggleFavorite,
  listFavoriteFolders,
  moveFavoriteToFolder,
  getCommentFeed,
  loadCommentReplies,
  postComment,
  postCommentReply,

  // discovery
  getAdvancedSearchScheme,
  getComicListSceneBundle,
  getRankingData,
  getRankingFilterBundle,

  // settings
  getSettingsBundle,
  getCapabilitiesBundle,
  getUserInfoBundle,

  // fnPath callbacks
  onAuthChanged,
  onQualityChanged,
  clearPluginCache,

  // function pages
  getFunctionPage,
};
