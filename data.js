
"use strict";

/*
  WATCH ARCHIVE
  Data definitions and initial configuration.

  Do not put private reviews or personal
  archive data directly into this file.
*/

window.WATCH_DATA = {
  appName: "Watch Archive",
  version: "1.0.0",
  schemaVersion: 1,

  storageKey: "watch_archive_v1",

  pages: {
    library: {
      title: "Library",
      subtitle: "Every story has a place."
    },

    groups: {
      title: "Groups",
      subtitle: "Worlds within worlds."
    },

    rankings: {
      title: "Rankings",
      subtitle: "The stories that stayed."
    },

    history: {
      title: "History",
      subtitle: "A record of what you've seen."
    },

    settings: {
      title: "Settings",
      subtitle: "Make this universe your own."
    }
  },

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

  rating: {
    minimum: 1,
    maximum: 10,
    increment: 0.5
  }
};
