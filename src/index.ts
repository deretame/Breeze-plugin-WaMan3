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
import { flutterTools } from "breeze-plugin-kit";
import {
  AUTH_ACCOUNT_CONFIG_KEY,
  AUTH_PASSWORD_CONFIG_KEY,
  CONTENT_MODE_CONFIG_KEY,
  ContentMode,
  clearAuthState,
  contentModeToGender,
  getAuthState,
  getResponseData,
  init as initApi,
  loadAuthCredentials,
  loadContentMode,
  loginWithoutCaptcha,
  logout as logoutFromApi,
  manwaApi,
  saveAuthCredentials,
  saveContentMode,
} from "./api";
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

type ManwaFeedData = {
  list?: ManwaSearchItem[];
  nums?: number;
  size?: number;
  ads?: unknown;
};

type ManwaCategoryData = ManwaFeedData & {
  current_page_tags?: Array<{ tag?: string; isBlacklisted?: boolean }>;
};

// breeze-plugin-kit 旧版本尚未导出收藏工作流类型；这里按
// plugin-dev-docs 中的 1.0 契约声明本插件实际使用的最小类型。
type FavoriteWorkflowAction = "add" | "removeAll" | "removeFromTarget" | "move";

type FavoriteWorkflowStartPayload = {
  comicId?: string;
  action?: FavoriteWorkflowAction;
  currentFavorite?: boolean;
  context?: { target?: { id?: string; name?: string } };
  extern?: StringMap;
};

type FavoriteWorkflowContinuePayload = {
  comicId?: string;
  action?: FavoriteWorkflowAction;
  continuationToken?: string;
  input?: {
    cancelled?: boolean;
    key?: string;
    value?: unknown;
    created?: string;
    values?: Record<string, unknown>;
  };
  extern?: StringMap;
};

type FavoriteWorkflowResult = {
  status: "completed" | "awaitingInput" | "partial" | "failed" | "cancelled";
  favorited?: boolean;
  committed?: boolean;
  message?: string;
  errorCode?: string;
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

const CONTENT_MODE_OPTIONS: Array<{ label: string; value: ContentMode }> = [
  { label: "全部", value: "all" },
  { label: "BL", value: "bl" },
  { label: "禁漫 / 成人", value: "adult" },
  { label: "一般", value: "normal" },
  { label: "TL", value: "tl" },
  { label: "GL", value: "gl" },
];

function readNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readApiPage(payload: { page?: unknown; extern?: StringMap }): number {
  const extern = toStringMap(payload.extern);
  const requested = readNumber(payload.page ?? extern.page, 1);
  // Breeze pages are one-based; Manwa3 list APIs are zero-based.
  return Math.max(0, Math.trunc(requested) - 1);
}

async function readGender(
  payload: { extern?: StringMap },
  fallback: -2 | -1 = -1,
): Promise<number> {
  const extern = toStringMap(payload.extern);
  const explicit = extern.gender ?? extern.c_gender;
  if (explicit !== undefined && explicit !== null && String(explicit).trim()) {
    return Math.trunc(readNumber(explicit, fallback));
  }
  return contentModeToGender(await loadContentMode(), fallback);
}

function buildPagedList(
  payload: { extern?: StringMap },
  type: string,
  rawItems: unknown,
  pageSize: number,
): ComicPagedListContract {
  const items = Array.isArray(rawItems)
    ? rawItems
        .filter((item): item is ManwaSearchItem => Boolean(item))
        .map(buildSearchItem)
    : [];
  return {
    source: PLUGIN_ID,
    extern: payload.extern ?? null,
    scheme: {
      version: "1.0.0" as const,
      type,
      card: "comicGrid",
    },
    data: {
      items,
      hasReachedMax: items.length < pageSize,
    },
  };
}

// ---------------------------------------------------------------------------
// getInfo — 插件注册信息
// ---------------------------------------------------------------------------

type LoginToastLevel = "info" | "success" | "error";

async function showLoginToast(
  message: string,
  level: LoginToastLevel,
): Promise<void> {
  try {
    await flutterTools.showToast({
      title: "蛙漫3登录",
      message,
      level,
      seconds: level === "info" ? 2 : 4,
    });
  } catch {
    // Toast 失败不能影响登录结果或公开内容浏览。
  }
}

function getLoginErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message.trim() || "未知错误";
}

async function loginWithToast(
  account: string,
  password: string,
): Promise<{ uid?: string | number; ssid?: string }> {
  await showLoginToast("正在登录，请稍候…", "info");
  try {
    const result = await loginWithoutCaptcha({ account, password });
    await showLoginToast("登录成功，已保存登录状态", "success");
    return result;
  } catch (error) {
    await showLoginToast(`登录失败：${getLoginErrorMessage(error)}`, "error");
    throw error;
  }
}

async function init(): Promise<void> {
  await initApi();
  const { account, password } = await loadAuthCredentials();
  if (!account || !password.trim()) return;

  // 初始化时自动登录一次。登录失败不应阻断未登录用户浏览公开内容；
  // 收藏等登录接口会继续返回明确的业务错误。
  try {
    await loginWithToast(account, password);
  } catch {
    // 登录结果已经通过 Toast 告知用户。
  }
}

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
    // 详情接口没有返回当前账号的明确收藏布尔值；宿主在调用收藏入口时会
    // 传入 currentFavorite，收藏操作本身再返回真实的下一状态。
    isFavourite: false,
    isLiked: false,
    allowComments: false,
    allowLike: false,
    allowCollected: true,
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

async function updateFavorite(
  comicId: string,
  favorited: boolean,
  extern: StringMap = {},
): Promise<void> {
  const folderId = String(extern.folderId ?? "").trim();
  const body: Record<string, unknown> = {
    val: favorited ? 0 : 1,
    book_id: comicId,
  };
  if (favorited && folderId) {
    body.folder_id = folderId;
  }

  getResponseData(await manwaApi.post("/api/detail/favorite", body));
}

function favoriteWorkflowFailure(
  payload: FavoriteWorkflowStartPayload | FavoriteWorkflowContinuePayload,
  message: string,
  errorCode: string,
): FavoriteWorkflowResult {
  const currentFavorite =
    "currentFavorite" in payload && typeof payload.currentFavorite === "boolean"
      ? payload.currentFavorite
      : undefined;
  return {
    status: "failed",
    favorited: currentFavorite,
    committed: false,
    message,
    errorCode,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 新版收藏工作流：WaMan3 已确认支持全局收藏和全局取消收藏，
 * 所以 add/removeAll 可以直接完成，不需要返回 continuationToken。
 */
async function startFavoriteAction(
  payload: FavoriteWorkflowStartPayload = {},
): Promise<FavoriteWorkflowResult> {
  const comicId = String(payload.comicId ?? "").trim();
  const action = payload.action;
  if (!comicId) {
    return favoriteWorkflowFailure(
      payload,
      "comicId 不能为空",
      "INVALID_COMIC_ID",
    );
  }
  if (!action) {
    return favoriteWorkflowFailure(payload, "缺少收藏动作", "INVALID_ACTION");
  }
  if (action !== "add" && action !== "removeAll") {
    return favoriteWorkflowFailure(
      payload,
      "当前图源只支持全局收藏和全局取消收藏",
      "UNSUPPORTED_ACTION",
    );
  }

  const favorited = action === "add";
  try {
    await updateFavorite(comicId, favorited, toStringMap(payload.extern));
    return { status: "completed", favorited, committed: true };
  } catch (error) {
    return favoriteWorkflowFailure(
      payload,
      `收藏请求失败：${errorMessage(error)}`,
      "FAVORITE_REQUEST_FAILED",
    );
  }
}

/**
 * WaMan3 不会产生需要用户输入的继续令牌；保留该 fnPath 是为了完整
 * 实现新版契约，并对外部误传的 continuationToken 给出失败结果。
 */
async function continueFavoriteAction(
  payload: FavoriteWorkflowContinuePayload = {},
): Promise<FavoriteWorkflowResult> {
  void payload.input;
  void payload.extern;
  if (!String(payload.comicId ?? "").trim()) {
    return favoriteWorkflowFailure(
      payload,
      "comicId 不能为空",
      "INVALID_COMIC_ID",
    );
  }
  if (!payload.action) {
    return favoriteWorkflowFailure(payload, "缺少收藏动作", "INVALID_ACTION");
  }
  if (!String(payload.continuationToken ?? "").trim()) {
    return favoriteWorkflowFailure(
      payload,
      "收藏工作流令牌无效或已过期",
      "INVALID_CONTINUATION_TOKEN",
    );
  }
  return favoriteWorkflowFailure(
    payload,
    "当前收藏操作不需要继续交互",
    "UNSUPPORTED_CONTINUATION",
  );
}

async function toggleFavorite(
  payload: ToggleFavoritePayload = {},
): Promise<ToggleFavoriteResult> {
  const comicId = String(payload.comicId ?? "").trim();
  if (!comicId) throw new Error("comicId 不能为空");

  const favorited = payload.currentFavorite !== true;
  await updateFavorite(comicId, favorited, toStringMap(payload.extern));
  return { favorited, nextStep: "none" };
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
  // The recovered Manwa3 API exposes global add/remove only. Returning false
  // is safer than claiming a folder move that was never sent to the server.
  return { ok: false };
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
  const extern = toStringMap(_payload.extern);
  const rankTypeValue = extern.rankType ?? extern.type;
  const rankType =
    rankTypeValue === "week"
      ? 1
      : rankTypeValue === "month"
        ? 2
        : Math.trunc(readNumber(rankTypeValue, 0));
  const response = await manwaApi.get("/api/rank/index", {
    params: {
      c_gender: await readGender(_payload),
      type: rankType,
      page: readApiPage(_payload),
    },
  });
  const data = getResponseData<ManwaFeedData>(response);
  return buildPagedList(_payload, "rankingFeed", data.list, 50);
}

// ---------------------------------------------------------------------------
// getNewestData — 更新列表
// ---------------------------------------------------------------------------

async function getNewestData(
  payload: SearchComicPayload = {},
): Promise<ComicPagedListContract> {
  const response = await manwaApi.get("/api/newest/index", {
    params: {
      page: readApiPage(payload),
      c_gender: await readGender(payload),
    },
  });
  const data = getResponseData<ManwaSearchItem[] | ManwaFeedData>(response);
  const items = Array.isArray(data) ? data : data.list;
  return buildPagedList(payload, "newestFeed", items, 12);
}

// ---------------------------------------------------------------------------
// getCategoryData — 分类列表
// ---------------------------------------------------------------------------

async function getCategoryData(
  payload: SearchComicPayload = {},
): Promise<ComicPagedListContract> {
  const extern = toStringMap(payload.extern);
  const response = await manwaApi.get("/api/classes/index", {
    params: {
      gender: await readGender(payload, -2),
      tag: String(extern.tag ?? ""),
      area: Math.trunc(readNumber(extern.area, 0)),
      end: Math.trunc(readNumber(extern.end, 0)),
      has_full: Math.trunc(readNumber(extern.has_full, 0)),
      level: Math.trunc(readNumber(extern.level, 0)),
      st: Math.trunc(readNumber(extern.st, 0)),
      page: readApiPage(payload),
      orderBy: Math.trunc(readNumber(extern.orderBy, 0)),
    },
  });
  const data = getResponseData<ManwaCategoryData>(response);
  return buildPagedList(payload, "categoryFeed", data.list, 12);
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

async function getCategoryFilterBundle(
  payload: SearchComicPayload = {},
): Promise<FilterBundleContract> {
  const response = await manwaApi.get("/api/classes/index", {
    params: {
      gender: await readGender(payload, -2),
      tag: "",
      area: 0,
      end: 0,
      has_full: 0,
      level: 0,
      st: 0,
      page: 0,
      orderBy: 0,
    },
  });
  const data = getResponseData<ManwaCategoryData>(response);
  const extern = toStringMap(payload.extern);
  const tags = (data.current_page_tags ?? [])
    .filter((item) => item.isBlacklisted !== true && String(item.tag ?? ""))
    .map((item) => String(item.tag));

  return {
    source: PLUGIN_ID,
    scheme: {
      version: "1.0.0" as const,
      type: "filter" as const,
      title: "分类标签",
      fields: [
        {
          key: "tag",
          kind: "choice" as const,
          label: "标签",
          options: [
            { label: "全部", value: "", result: { extern: { tag: "" } } },
            ...tags.map((tag) => ({
              label: tag,
              value: tag,
              result: { extern: { tag } },
            })),
          ],
        },
      ],
    },
    data: { values: { tag: String(extern.tag ?? "") } },
  };
}

async function getNewestSceneBundle(): Promise<ComicListSceneBundleContract> {
  return {
    source: PLUGIN_ID,
    scheme: {
      version: "1.0.0" as const,
      type: "comicListSceneBundle" as const,
    },
    data: {
      scene: {
        title: "更新",
        source: PLUGIN_ID,
        body: {
          type: "pluginPagedComicList" as const,
          request: { fnPath: "getNewestData", core: {}, extern: {} },
        },
      },
    },
  };
}

async function getCategorySceneBundle(): Promise<ComicListSceneBundleContract> {
  return {
    source: PLUGIN_ID,
    scheme: {
      version: "1.0.0" as const,
      type: "comicListSceneBundle" as const,
    },
    data: {
      scene: {
        title: "分类",
        source: PLUGIN_ID,
        body: {
          type: "pluginPagedComicList" as const,
          request: { fnPath: "getCategoryData", core: {}, extern: {} },
        },
        filter: {
          fnPath: "getCategoryFilterBundle",
          core: {},
          extern: {},
        },
      },
    },
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
  const [{ account, password }, contentMode] = await Promise.all([
    loadAuthCredentials(),
    loadContentMode(),
  ]);
  return {
    source: PLUGIN_ID,
    scheme: {
      version: "1.0.0" as const,
      type: "settings" as const,
      sections: [
        {
          id: "account",
          title: "账号",
          fields: [
            {
              key: AUTH_ACCOUNT_CONFIG_KEY,
              kind: "text" as const,
              label: "账号",
              fnPath: "onAuthChanged",
            },
            {
              key: AUTH_PASSWORD_CONFIG_KEY,
              kind: "password" as const,
              label: "密码",
              fnPath: "onAuthChanged",
            },
          ],
        },
        {
          id: "content",
          title: "内容",
          fields: [
            {
              key: CONTENT_MODE_CONFIG_KEY,
              kind: "choice" as const,
              label: "内容模式",
              options: CONTENT_MODE_OPTIONS,
              fnPath: "onContentModeChanged",
            },
          ],
        },
      ],
    },
    data: {
      canShowUserInfo: true,
      values: {
        [AUTH_ACCOUNT_CONFIG_KEY]: account,
        [AUTH_PASSWORD_CONFIG_KEY]: password,
        [CONTENT_MODE_CONFIG_KEY]: contentMode,
      },
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
        { key: "logout", title: "退出登录", fnPath: "logoutAccount" },
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
  const auth = await getAuthState();
  const lines = auth.loggedIn
    ? [auth.account, auth.uid ? `用户 ID：${auth.uid}` : "已登录"]
    : ["未登录"];
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
      lines,
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
  const current = await loadAuthCredentials();
  const values = toStringMap(payload.allValues);
  let account = current.account;
  let password = current.password;

  if (AUTH_ACCOUNT_CONFIG_KEY in values) {
    account = String(values[AUTH_ACCOUNT_CONFIG_KEY] ?? "").trim();
  }
  if (AUTH_PASSWORD_CONFIG_KEY in values) {
    password = String(values[AUTH_PASSWORD_CONFIG_KEY] ?? "");
  }
  if (payload.key === AUTH_ACCOUNT_CONFIG_KEY) {
    account = String(payload.value ?? "").trim();
  }
  if (payload.key === AUTH_PASSWORD_CONFIG_KEY) {
    password = String(payload.value ?? "");
  }

  await saveAuthCredentials(account, password);
  if (!account || !password.trim()) {
    return { ok: true, loggedIn: false, message: "请填写账号和密码" };
  }

  try {
    const result = await loginWithToast(account, password);
    return {
      ok: true,
      loggedIn: true,
      uid: result.uid === undefined ? "" : String(result.uid),
    };
  } catch (error) {
    // 避免新账号登录失败时继续沿用旧账号的 Cookie。
    await clearAuthState();
    return {
      ok: false,
      loggedIn: false,
      message: getLoginErrorMessage(error),
    };
  }
}

async function onContentModeChanged(
  payload: { key?: string; value?: unknown; allValues?: StringMap } = {},
): Promise<Record<string, unknown>> {
  const values = toStringMap(payload.allValues);
  const value =
    payload.key === CONTENT_MODE_CONFIG_KEY
      ? payload.value
      : values[CONTENT_MODE_CONFIG_KEY];
  const mode = await saveContentMode(value);
  return {
    ok: true,
    [CONTENT_MODE_CONFIG_KEY]: mode,
    message: `内容模式已切换为${
      CONTENT_MODE_OPTIONS.find((option) => option.value === mode)?.label ??
      mode
    }`,
  };
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

async function logoutAccount(): Promise<Record<string, unknown>> {
  await logoutFromApi();
  return { ok: true, loggedIn: false };
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
  startFavoriteAction,
  continueFavoriteAction,
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
  getNewestData,
  getNewestSceneBundle,
  getCategoryData,
  getCategoryFilterBundle,
  getCategorySceneBundle,

  // settings
  getSettingsBundle,
  getCapabilitiesBundle,
  getUserInfoBundle,

  // fnPath callbacks
  onAuthChanged,
  onContentModeChanged,
  onQualityChanged,
  logoutAccount,
  clearPluginCache,

  // function pages
  getFunctionPage,
};
