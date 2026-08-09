import { register } from "node:module";

register("./rc6-test-loader.mjs", new URL("./", import.meta.url));
