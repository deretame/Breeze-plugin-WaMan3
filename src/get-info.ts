import type { InfoContract } from "breeze-plugin-kit";
import { PLUGIN_ID } from "./common";

export function buildPluginInfo(): InfoContract {
  return {
    name: "蛙漫3",
    uuid: PLUGIN_ID,
    iconUrl: "https://manwa.wang/template/wap/32/images/top_icon.png",
    creator: {
      name: "",
      describe: "",
    },
    describe: "蛙漫插件",
    version: "0.0.5",
    home: "https://github.com/deretame/Breeze-plugin-WaMan3",
    updateUrl:
      "https://api.github.com/repos/deretame/Breeze-plugin-WaMan3/releases/latest",
    npmName: "breeze-plugin-waman3",
    function: [
      {
        id: "newest",
        title: "更新",
        action: {
          type: "openComicList",
          payload: {
            scene: {
              title: "更新",
              source: PLUGIN_ID,
              body: {
                type: "pluginPagedComicList",
                request: {
                  fnPath: "getNewestData",
                  core: {},
                  extern: { source: "newest" },
                },
              },
            },
          },
        },
      },
      {
        id: "ranking",
        title: "排行",
        action: {
          type: "openComicList",
          payload: {
            scene: {
              title: "排行",
              source: PLUGIN_ID,
              body: {
                type: "pluginPagedComicList",
                request: {
                  fnPath: "getRankingData",
                  core: {},
                  extern: { source: "ranking" },
                },
              },
              filter: {
                fnPath: "getRankingFilterBundle",
                core: {},
                extern: { source: "ranking" },
              },
            },
          },
        },
      },
      {
        id: "categories",
        title: "分类",
        action: {
          type: "openComicList",
          payload: {
            scene: {
              title: "分类",
              source: PLUGIN_ID,
              body: {
                type: "pluginPagedComicList",
                request: {
                  fnPath: "getCategoryData",
                  core: {},
                  extern: { source: "categories" },
                },
              },
              filter: {
                fnPath: "getCategoryFilterBundle",
                core: {},
                extern: { source: "categories" },
              },
            },
          },
        },
      },
      {
        id: "cloudFavorite",
        title: "云端收藏",
        action: {
          type: "openComicList",
          payload: {
            scene: {
              title: "云端收藏",
              source: PLUGIN_ID,
              body: {
                type: "pluginPagedComicList",
                request: {
                  fnPath: "getCloudFavoriteData",
                  core: {},
                  extern: { source: "cloudFavorite" },
                },
              },
              filter: {
                fnPath: "getCloudFavoriteFilterBundle",
                core: {},
                extern: { source: "cloudFavorite" },
              },
            },
          },
        },
      },
    ],
  };
}

export function buildManifestInfo(): InfoContract {
  return buildPluginInfo();
}
