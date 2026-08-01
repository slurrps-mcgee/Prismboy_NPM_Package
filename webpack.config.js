import { fileURLToPath } from "url";
import { dirname, resolve as _resolve } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default {
  entry: "./src/gameboy.ts",
  mode: "production",
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: "ts-loader",
        exclude: [/node_modules/, /\.test\.ts$/, /tests/, /example\.ts$/],
      },
    ],
  },
  experiments: {
    outputModule: true,
  },
  resolve: {
    alias: {
      "@": _resolve(__dirname, "src"),
    },
    extensions: [".tsx", ".ts", ".js"],
  },
  output: {
    filename: "gameboy.js",
    path: _resolve(__dirname, "dist"),
    clean: true,
    library: {
      type: "module",
    },
  },
};
