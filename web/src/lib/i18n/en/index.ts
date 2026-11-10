import ai from "./ai";
import common from "./common";
import guide from "./guide";
import inbox from "./inbox";
import pages from "./pages";
import settings from "./settings";
import yt from "./yt";
import ytViews from "./yt-views";

// English for every UI string, one file per area (each owned by one area's components); keys are the Vietnamese source.
export const EN = { ...common, ...settings, ...inbox, ...pages, ...ai, ...yt, ...ytViews, ...guide };
