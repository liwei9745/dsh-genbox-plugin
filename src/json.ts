/** Minimal JSON value model shared by the GenBox tools. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
export type JsonObject = { [key: string]: Json }
