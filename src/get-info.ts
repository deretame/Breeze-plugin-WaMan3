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
    version: "0.0.1",
    home: "https://github.com/deretame/Breeze-plugin-WaMan3",
    updateUrl:
      "https://api.github.com/repos/deretame/Breeze-plugin-WaMan3/releases/latest",
    npmName: "breeze-plugin-waman3",
    function: [],
  };
}

export function buildManifestInfo(): InfoContract {
  return buildPluginInfo();
}
