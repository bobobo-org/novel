import { register } from "node:module";

register("./seedance-test-loader.mjs", new URL("./", import.meta.url));
