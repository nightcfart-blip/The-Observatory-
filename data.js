
"use strict";

/*
  WATCH ARCHIVE — STEP 2
  Cosmic Library Configuration

  Private archive entries are never
  stored in this public source file.
*/

window.WATCH_DATA = {

  appName: "Watch Archive",
  version: "2.0.0",
  schemaVersion: 1,
  storageKey: "watch_archive_v1",


  /* =====================================
     DEFAULT STORAGE
  ===================================== */

  defaults: {
    settings: {
      starDensity: 75,
      starBrightness: 60,
      reduceMotion: false,

      nebulaIntensity: 65,
      constellationGlow: 65
    },

    archive: {
      groups: [],
      productions: [],
      seasons: [],
      episodes: []
    }
  },


  /* =====================================
     CAMERA

     Higher maximum zoom for exploring
     nested constellations.

     Camera animations use logarithmic
     interpolation and fixed-screen labels.
  ===================================== */

  camera: {
    minZoom: 0.10,
    maxZoom: 24,

    initialZoom: 0.8,

    wheelSensitivity: 0.0011,
    pinchSensitivity: 1,

    travelDuration: 1000,

    tapThreshold: 10,

    smoothness: 0.16
  },


  /* =====================================
     GRAPHICS QUALITY

     Adaptive rendering will adjust to
     device capabilities in app.js.
  ===================================== */

  graphics: {
    maxPixelRatio: 1.5,

    targetFrameRate: 60,

    backgroundStarCount: 1250,

    maximumBackgroundStars: 1900,

    nebulaResolution: 0.62,

    nebulaCloudCount: 8,

    nebulaDetail: 4,

    enableParallax: true,

    enableTwinkling: true,

    adaptiveQuality: true
  },


  /* =====================================
     CONSTELLATION APPEARANCE
  ===================================== */

  appearance: {
    navigationStars: {
      radius: 5.0,
      glow: 35,
      color: [232, 235, 255]
    },

    groupStars: {
      radius: 3.9,
      glow: 28,
      color: [209, 201, 255]
    },

    productionStars: {
      radius: 3.0,
      glow: 21,
      color: [196, 204, 255]
    },

    seasonStars: {
      radius: 2.3,
      glow: 16,
      color: [201, 204, 245]
    },

    episodeStars: {
      radius: 1.7,
      glow: 11,
      color: [199, 207, 242]
    },

    lineOpacity: 0.26,

    activeLineOpacity: 0.65
  },


  /* =====================================
     SEMANTIC ZOOM

     Children reveal progressively
     as camera zoom increases.

     Parent and child systems remain in
     the same coordinate space.
  ===================================== */

  semanticZoom: {
    productions: {
      start: 1.10,
      full: 2.0
    },

    seasons: {
      start: 2.7,
      full: 4.5
    },

    episodes: {
      start: 6.0,
      full: 9.0
    }
  },


  /* =====================================
     MAIN CONSTELLATION

     Cassiopeia-inspired irregular zigzag.

     Order:
     Library
     History
     Rankings
     Watchlist
     Settings
  ===================================== */

  navigation: {
    id: "main-navigation",
    type: "navigation",

    nodes: [
      {
        id: "library",
        title: "Library",
        x: -520,
        y: -70,
        magnitude: 1.5,
        action: "library"
      },

      {
        id: "history",
        title: "History",
        x: -260,
        y: 80,
        magnitude: 2.3,
        action: "history"
      },

      {
        id: "rankings",
        title: "Rankings",
        x: -10,
        y: -205,
        magnitude: 1.2,
        action: "rankings"
      },

      {
        id: "watchlist",
        title: "Watchlist",
        x: 255,
        y: 15,
        magnitude: 1.9,
        action: "watchlist"
      },

      {
        id: "settings",
        title: "Settings",
        x: 530,
        y: -255,
        magnitude: 2.0,
        action: "settings"
      }
    ],

    connections: [
      ["library", "history"],
      ["history", "rankings"],
      ["rankings", "watchlist"],
      ["watchlist", "settings"]
    ]
  },


  /* =====================================
     GROUP PLACEMENT

     Individual groups exist separately,
     scattered around the same world.
  ===================================== */

  groupPlacement: {
    initialRadius: 1450,

    minimumSpacing: 750,

    distanceGrowth: 350,

    angleOffset: -0.62,

    seed: 73129
  },


  /* =====================================
     ONLY DEMONSTRATION GROUP

     Not stored in the personal archive.
     No Harry Potter or Star Wars demos.
  ===================================== */

  demoGroups: [
    {
      id: "demo-asoiaf",
      title: "A Song of Ice and Fire",
      type: "group",
      demo: true,

      x: 1380,
      y: -760,

      genres: ["Fantasy", "Drama"],

      subgenres: [
        "Dragons",
        "Political Intrigue",
        "Medieval Fantasy"
      ],

      thoughts: "",

      children: [
        {
          id: "demo-got",
          title: "Game of Thrones",
          type: "production",

          mediaType: "TV Series",
          startYear: 2011,
          endYear: 2019,
          status: "Finished",

          children: [
            {
              id: "demo-got-s1",
              title: "Season 1",
              type: "season",

              children: [
                {
                  id: "demo-got-e1",
                  title: "Winter Is Coming",
                  type: "episode",
                  duration: 62,
                  children: []
                },

                {
                  id: "demo-got-e2",
                  title: "The Kingsroad",
                  type: "episode",
                  duration: 56,
                  children: []
                },

                {
                  id: "demo-got-e3",
                  title: "Lord Snow",
                  type: "episode",
                  duration: 58,
                  children: []
                }
              ]
            },

            {
              id: "demo-got-s2",
              title: "Season 2",
              type: "season",
              children: []
            },

            {
              id: "demo-got-s3",
              title: "Season 3",
              type: "season",
              children: []
            }
          ]
        },

        {
          id: "demo-hotd",
          title: "House of the Dragon",
          type: "production",

          mediaType: "TV Series",
          startYear: 2022,
          endYear: null,

          children: [
            {
              id: "demo-hotd-s1",
              title: "Season 1",
              type: "season",
              children: []
            },

            {
              id: "demo-hotd-s2",
              title: "Season 2",
              type: "season",
              children: []
            }
          ]
        },

        {
          id: "demo-knight",
          title: "A Knight of the Seven Kingdoms",
          type: "production",

          mediaType: "TV Series",

          children: []
        }
      ]
    }
  ],


  /* =====================================
     LIBRARY VIEWS

     Every collection here operates on
     productions ONLY.

     Groups, seasons and episodes are
     excluded from these lists.
  ===================================== */

  libraryViews: {
    library: {
      title: "Library",
      description: "Every story in your collection.",
      entityType: "production",
      defaultSort: "alphabetical"
    },

    history: {
      title: "History",
      description: "The stories you've watched.",
      entityType: "production",
      defaultSort: "lastWatched"
    },

    rankings: {
      title: "Rankings",
      description: "Your highest-rated stories.",
      entityType: "production",
      defaultSort: "highestRated"
    },

    watchlist: {
      title: "Watchlist",
      description: "Stories waiting to be discovered.",
      entityType: "production",
      defaultSort: "alphabetical"
    }
  },


  /* =====================================
     SORTING
  ===================================== */

  sorting: [
    {
      id: "alphabetical",
      title: "Alphabetical · A–Z"
    },

    {
      id: "alphabeticalReverse",
      title: "Alphabetical · Z–A"
    },

    {
      id: "highestRated",
      title: "Highest Rated"
    },

    {
      id: "lowestRated",
      title: "Lowest Rated"
    },

    {
      id: "lastWatched",
      title: "Last Watched"
    },

    {
      id: "oldestAdded",
      title: "Oldest Added"
    },

    {
      id: "newestAdded",
      title: "Newest Added"
    },

    {
      id: "earliestRelease",
      title: "Earliest Release"
    },

    {
      id: "latestRelease",
      title: "Latest Release"
    }
  ],


  /* =====================================
     GENRES

     Main genres are broad categories.
     Secondary genres/tags can be expanded
     freely in a later editing batch.
  ===================================== */

  mainGenres: [
    "Action",
    "Adventure",
    "Animation",
    "Comedy",
    "Crime",
    "Documentary",
    "Drama",
    "Fantasy",
    "Historical",
    "Horror",
    "Mystery",
    "Romance",
    "Science Fiction",
    "Thriller",
    "War",
    "Western",
    "Other"
  ],


  /* =====================================
     MEDIA TYPES & WATCHING STATUSES
  ===================================== */

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


  /* =====================================
     FUTURE RATING ENGINE
  ===================================== */

  ratings: {
    minimum: 1,
    maximum: 10,
    increment: 0.5,

    decimalPlaces: 2,

    ignoreUnrated: true
  }

};
