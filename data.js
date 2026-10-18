
"use strict";

window.WATCH_DATA = {
  appName: "Watch Archive",
  version: "1.0.0",
  schemaVersion: 1,
  storageKey: "watch_archive_v1",

  defaults: {
    settings: {
      starDensity: 65,
      starBrightness: 55,
      reduceMotion: false
    },
    archive: {
      groups: [],
      productions: [],
      seasons: [],
      episodes: []
    }
  },

  sections: [
    "library",
    "groups",
    "rankings",
    "history",
    "settings"
  ],

  mediaTypes: [
    "TV Series",
    "Movie",
    "Miniseries",
    "Documentary",
    "Anime",
    "Short Film",
    "Special",
    "Other"
  ],

  statuses: [
    "Watching",
    "Finished",
    "Discontinued",
    "Planned"
  ],

  ratings: {
    minimum: 1,
    maximum: 10,
    increment: 0.5
  }
};
