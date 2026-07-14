import { register } from "node:module";

register("./ts-extension-loader.mjs", new URL("./", import.meta.url));
