
"use strict";

window.WATCH_DATA = {
  appName: "Watch Archive",
  version: "1.1.0",
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

  mainNodes: [
    {
      id: "library",
      name: "Library",
      x: -360,
      y: -60,
      size: 10,
      type: "navigation"
    },
    {
      id: "groups",
      name: "Groups",
      x: 90,
      y: -185,
      size: 11,
      type: "navigation"
    },
    {
      id: "rankings",
      name: "Rankings",
      x: 370,
      y: 85,
      size: 9,
      type: "navigation"
    },
    {
      id: "history",
      name: "History",
      x: -210,
      y: 220,
      size: 9,
      type: "navigation"
    },
    {
      id: "settings",
      name: "Settings",
      x: 160,
      y: 290,
      size: 8,
      type: "navigation"
    }
  ],

  mainConnections: [
    ["library", "groups"],
    ["groups", "rankings"],
    ["rankings", "settings"],
    ["settings", "history"],
    ["history", "library"],
    ["library", "settings"]
  ],

  /*
    Temporary interactive demonstration.

    This is NOT part of your saved archive.
    It will be replaced by real groups in Step 3.
  */
  demo: {
    id: "demo-universe",
    name: "A Song of Ice and Fire",
    type: "group",
    demo: true,

    children: [
      {
        id: "demo-got",
        name: "Game of Thrones",
        type: "production",
        children: [
          {
            id: "demo-got-s1",
            name: "Season 1",
            type: "season",
            children: [
              {
                id: "demo-got-s1-e1",
                name: "Winter Is Coming",
                type: "episode",
                children: []
              },
              {
                id: "demo-got-s1-e2",
                name: "The Kingsroad",
                type: "episode",
                children: []
              },
              {
                id: "demo-got-s1-e3",
                name: "Lord Snow",
                type: "episode",
                children: []
              }
            ]
          },
          {
            id: "demo-got-s2",
            name: "Season 2",
            type: "season",
            children: [
              {
                id: "demo-got-s2-e1",
                name: "The North Remembers",
                type: "episode",
                children: []
              }
            ]
          },
          {
            id: "demo-got-s3",
            name: "Season 3",
            type: "season",
            children: []
          }
        ]
      },
      {
        id: "demo-hotd",
        name: "House of the Dragon",
        type: "production",
        children: [
          {
            id: "demo-hotd-s1",
            name: "Season 1",
            type: "season",
            children: []
          },
          {
            id: "demo-hotd-s2",
            name: "Season 2",
            type: "season",
            children: []
          }
        ]
      },
      {
        id: "demo-knight",
        name: "A Knight of the Seven Kingdoms",
        type: "production",
        children: []
      }
    ]
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

  ratings: {
    minimum: 1,
    maximum: 10,
    increment: 0.5
  }
};
