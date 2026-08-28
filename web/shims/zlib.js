import { gzipSync as gzip, gunzipSync as gunzip } from "fflate";

export const constants = {
  Z_BEST_SPEED: 1,
  Z_BEST_COMPRESSION: 9,
  Z_DEFAULT_COMPRESSION: 6,
};

export function gzipSync(input, options = {}) {
  return gzip(input, { level: options.level ?? constants.Z_DEFAULT_COMPRESSION });
}

export function gunzipSync(input) {
  return gunzip(input);
}
