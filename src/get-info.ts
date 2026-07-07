import type { InfoContract } from "../types/type";
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
    version: "0.0.1",
    home: "",
    updateUrl: "",
    npmName: "breeze-plugin-waman3",
    function: [],
  };
}

export function buildManifestInfo(): InfoContract {
  return buildPluginInfo();
}
