
"use strict";

/*
  WATCH ARCHIVE — STEP 3
  GROUPS, HIERARCHY & MANUAL GENRES

  Source code defines defaults and behavior.
  Personal data remains in browser storage.
*/

window.WATCH_DATA = {

  appName: "Watch Archive",
  version: "3.0.0",

  schemaVersion: 1,
  storageKey: "watch_archive_v1",

  /* =====================================
     DEFAULT ARCHIVE STATE
  ===================================== */

  defaults: {
    settings: {
      starDensity: 75,
      starBrightness: 60,
      nebulaIntensity: 65,
      constellationGlow: 65,
      reduceMotion: false
    },

    archive: {
      groups: [],
      productions: [],
      seasons: [],
      episodes: [],

      genres: [],
      secondaryGenres: []
    }
  },

  /* =====================================
     CAMERA
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
     GRAPHICS
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
     STAR APPEARANCE

     Appearance is derived from each
     individual object's stable ID.

     The renderer will apply unique:
     - Core radius
     - Brightness
     - Color temperature
     - Halo variation
     - Diffraction spikes
     - Asymmetry
     - Twinkle speed
  ===================================== */

  appearance: {
    navigationStars: {
      radius: 4.6,
      glow: 34,
      color: [226, 230, 255]
    },

    groupStars: {
      radius: 3.6,
      glow: 26,
      color: [207, 201, 255]
    },

    productionStars: {
      radius: 2.9,
      glow: 20,
      color: [192, 206, 255]
    },

    seasonStars: {
      radius: 2.2,
      glow: 15,
      color: [203, 205, 246]
    },

    episodeStars: {
      radius: 1.65,
      glow: 10,
      color: [201, 211, 242]
    },

    lineOpacity: .23,
    activeLineOpacity: .64
  },

  /* =====================================
     SEMANTIC ZOOM
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

     Cassiopeia-inspired, irregular.

     History → Genre Creation
     Rankings → Create & Edit
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
        magnitude: 1.6,
        action: "library"
      },

      {
        id: "genres",
        title: "Genre Creation",
        x: -260,
        y: 80,
        magnitude: 2.7,
        action: "genres"
      },

      {
        id: "create",
        title: "Create & Edit",
        x: -10,
        y: -205,
        magnitude: 1.15,
        action: "create"
      },

      {
        id: "watchlist",
        title: "Watchlist",
        x: 255,
        y: 15,
        magnitude: 2.2,
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
      ["library", "genres"],
      ["genres", "create"],
      ["create", "watchlist"],
      ["watchlist", "settings"]
    ]
  },

  /* =====================================
     GROUP PLACEMENT
  ===================================== */

  groupPlacement: {
    initialRadius: 1450,
    minimumSpacing: 750,
    distanceGrowth: 350,
    angleOffset: -0.62,
    seed: 73129
  },

  /* =====================================
     DEMONSTRATION

     Kept for testing only until actual
     group creation replaces it.

     Not persisted in user storage.
  ===================================== */

  demoGroups: [
    {
      id: "demo-asoiaf",
      title: "A Song of Ice and Fire",
      type: "group",
      demo: true,
      x: 1380,
      y: -760,

      children: [
        {
          id: "demo-got",
          title: "Game of Thrones",
          type: "production",

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
                  children: []
                },
                {
                  id: "demo-got-e2",
                  title: "The Kingsroad",
                  type: "episode",
                  children: []
                }
              ]
            },
            {
              id: "demo-got-s2",
              title: "Season 2",
              type: "season",
              children: []
            }
          ]
        },

        {
          id: "demo-hotd",
          title: "House of the Dragon",
          type: "production",
          children: []
        }
      ]
    }
  ],

  /* =====================================
     ENTITY DEFINITIONS

     These describe the supported records.

     IDs remain stable during edits, moves,
     renames and reordering.
  ===================================== */

  entityTypes: {

    group: {
      collection: "groups",
      title: "Group",
      parentType: null,

      fields: [
        "title",
        "banner",
        "mainGenreIds",
        "secondaryGenreIds",
        "notes",
        "mapX",
        "mapY",
        "order"
      ]
    },

    production: {
      collection: "productions",
      title: "Production",
      parentType: "group",

      fields: [
        "title",
        "groupId",
        "mediaType",
        "banner",
        "mainGenreIds",
        "secondaryGenreIds",
        "notes",
        "releaseStart",
        "releaseEnd",
        "status",
        "watchlist",
        "lastWatched",
        "mapX",
        "mapY",
        "order"
      ]
    },

    season: {
      collection: "seasons",
      title: "Season",
      parentType: "production",

      fields: [
        "title",
        "productionId",
        "releaseStart",
        "releaseEnd",
        "status",
        "notes",
        "order"
      ]
    },

    episode: {
      collection: "episodes",
      title: "Episode",
      parentType: "season",

      fields: [
        "title",
        "seasonId",
        "duration",
        "notes",
        "watchedAt",
        "order"
      ]
    }
  },

  /* =====================================
     CUSTOM GENRES

     No built-in genre presets.
     Both collections start completely empty.

     Genres can be referenced by their IDs.
  ===================================== */

  genreTypes: {
    main: {
      collection: "genres",
      title: "Main Genre"
    },

    secondary: {
      collection: "secondaryGenres",
      title: "Secondary Genre / Tag"
    }
  },

  /* =====================================
     MEDIA TYPES
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
     COLLECTIONS
  ===================================== */

  libraryViews: {
    library: {
      title: "Library",
      description: "All your productions.",
      entityType: "production",
      defaultSort: "alphabetical"
    },

    watchlist: {
      title: "Watchlist",
      description: "Stories waiting to be discovered.",
      entityType: "production",
      defaultSort: "alphabetical"
    }
  },

  sorting: [
    { id: "alphabetical", title: "Alphabetical · A–Z" },
    { id: "alphabeticalReverse", title: "Alphabetical · Z–A" },
    { id: "highestRated", title: "Highest Rated" },
    { id: "lowestRated", title: "Lowest Rated" },
    { id: "lastWatched", title: "Last Watched" },
    { id: "oldestAdded", title: "Oldest Added" },
    { id: "newestAdded", title: "Newest Added" },
    { id: "earliestRelease", title: "Earliest Release" },
    { id: "latestRelease", title: "Latest Release" },
    { id: "custom", title: "Custom Order" }
  ],

  /* =====================================
     RATINGS — RESERVED FOR STEP 6
  ===================================== */

  ratings: {
    minimum: 1,
    maximum: 10,
    increment: .5,
    decimalPlaces: 2,
    ignoreUnrated: true
  }

};
