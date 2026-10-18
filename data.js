
"use strict";

/*
  WATCH ARCHIVE — STEP 4
  GROUP & PRODUCTION DETAIL PAGES

  Personal records:
    localStorage

  Uploaded image blobs:
    IndexedDB

  No external libraries or image hosting.
*/

window.WATCH_DATA = {

  appName: "Watch Archive",
  version: "4.0.0",

  schemaVersion: 1,
  storageKey: "watch_archive_v1",


  /* =====================================
     STORAGE & DEFAULTS
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
     BANNER IMAGE STORAGE

     When selecting a photo from your phone:

     1. The photo is decoded locally.
     2. It is resized and compressed.
     3. The resulting image is saved as
        a Blob in IndexedDB.
     4. The record stores its image key.

     Older URL-based banners remain
     readable for compatibility.
  ===================================== */

  images: {
    databaseName: "watch_archive_images_v1",
    databaseVersion: 1,
    objectStore: "banners",

    maximumInputMB: 35,

    maximumWidth: 1920,
    maximumHeight: 1080,

    quality: 0.83,
    preferredFormat: "image/jpeg",

    thumbnailWidth: 600,
    thumbnailHeight: 400,
    thumbnailQuality: 0.78,

    acceptedTypes: [
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/heic",
      "image/heif",
      "image/avif"
    ],

    defaultPositionX: 50,
    defaultPositionY: 35,

    defaultOpacity: 87
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

     Groups intentionally feel much less
     important than main navigation stars.

     Additional seeded variation continues
     to be applied by app.js.
  ===================================== */

  appearance: {
    navigationStars: {
      radius: 4.7,
      glow: 35,
      color: [226,230,255]
    },

    groupStars: {
      radius: 2.35,
      glow: 17,
      color: [197,192,244]
    },

    productionStars: {
      radius: 2.75,
      glow: 19,
      color: [192,206,255]
    },

    seasonStars: {
      radius: 2.1,
      glow: 14,
      color: [203,205,246]
    },

    episodeStars: {
      radius: 1.65,
      glow: 10,
      color: [201,211,242]
    },

    lineOpacity: 0.23,
    activeLineOpacity: 0.64
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

     Library
     Genre Creation
     Create & Edit
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
      ["library","genres"],
      ["genres","create"],
      ["create","watchlist"],
      ["watchlist","settings"]
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
     ONE TEMPORARY DEMO GROUP

     No uploaded image needed.
     It remains excluded from storage.
  ===================================== */

  demoGroups: [
    {
      id: "demo-asoiaf",
      title: "A Song of Ice and Fire",
      type: "group",
      demo: true,
      x: 1380,
      y: -760,

      mainGenreIds: [],
      secondaryGenreIds: [],
      notes: "",

      children: [
        {
          id: "demo-got",
          title: "Game of Thrones",
          type: "production",

          mediaType: "TV Series",
          releaseStart: "2011-04-17",
          releaseEnd: "2019-05-19",
          status: "Finished",

          children: [
            {
              id: "demo-got-s1",
              title: "Season 1",
              type: "season",
              releaseStart: "2011-04-17",
              status: "Finished",

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
          mediaType: "TV Series",
          releaseStart: "2022-08-21",
          status: "Watching",
          children: []
        }
      ]
    }
  ],


  /* =====================================
     GROUP & SERIES PAGE DESIGN
  ===================================== */

  detailPages: {
    group: {
      typeLabel: "COLLECTION",
      childType: "production",
      childLayout: "horizontal",

      showRating: true,
      showMainGenres: true,
      showSecondaryGenres: true,
      showObservations: true,

      showMediaType: false,
      showAiringDates: false,
      showPaperclip: false
    },

    production: {
      typeLabel: "PRODUCTION",
      childType: "season",
      childLayout: "vertical",

      showRating: true,
      showMainGenres: true,
      showSecondaryGenres: true,
      showObservations: true,

      showMediaType: true,
      showAiringDates: true,
      showPaperclip: true
    }
  },


  /* =====================================
     WATCHING STATUS & PAPERCLIP

     These colors appear in the gemstone.
  ===================================== */

  statusVisuals: {
    Watching: {
      key: "watching",
      color: "#416ce4"
    },

    Finished: {
      key: "finished",
      color: "#8b67dd"
    },

    Discontinued: {
      key: "discontinued",
      color: "#55c3cb"
    },

    Planned: {
      key: "planned",
      color: "#8d8fa6"
    }
  },


  /* =====================================
     ENTITY DEFINITIONS

     Stable IDs and parent links.

     Banner references are optional and
     remain compatible with old records.
  ===================================== */

  entityTypes: {

    group: {
      collection: "groups",
      title: "Group",
      parentType: null,

      fields: [
        "id",
        "title",

        "banner",
        "bannerImageId",
        "bannerPositionX",
        "bannerPositionY",

        "mainGenreIds",
        "secondaryGenreIds",
        "notes",

        "mapX",
        "mapY",
        "order",

        "createdAt",
        "updatedAt"
      ]
    },

    production: {
      collection: "productions",
      title: "Production",
      parentType: "group",

      fields: [
        "id",
        "title",
        "groupId",

        "banner",
        "bannerImageId",
        "bannerPositionX",
        "bannerPositionY",

        "mediaType",
        "mainGenreIds",
        "secondaryGenreIds",

        "releaseStart",
        "releaseEnd",

        "status",
        "watchlist",
        "lastWatched",

        "notes",

        "mapX",
        "mapY",
        "order",

        "createdAt",
        "updatedAt"
      ]
    },

    season: {
      collection: "seasons",
      title: "Season",
      parentType: "production",

      fields: [
        "id",
        "title",
        "productionId",

        "releaseStart",
        "releaseEnd",
        "status",
        "notes",
        "order",

        "createdAt",
        "updatedAt"
      ]
    },

    episode: {
      collection: "episodes",
      title: "Episode",
      parentType: "season",

      fields: [
        "id",
        "title",
        "seasonId",

        "duration",
        "notes",
        "watchedAt",
        "order",

        "rating",

        "createdAt",
        "updatedAt"
      ]
    }
  },


  /* =====================================
     MANUALLY CREATED GENRES
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
     MEDIA FORMATS
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
     LIBRARY / WATCHLIST
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
    { id:"alphabetical", title:"Alphabetical · A–Z" },
    { id:"alphabeticalReverse", title:"Alphabetical · Z–A" },
    { id:"highestRated", title:"Highest Rated" },
    { id:"lowestRated", title:"Lowest Rated" },
    { id:"lastWatched", title:"Last Watched" },
    { id:"oldestAdded", title:"Oldest Added" },
    { id:"newestAdded", title:"Newest Added" },
    { id:"earliestRelease", title:"Earliest Release" },
    { id:"latestRelease", title:"Latest Release" },
    { id:"custom", title:"Custom Order" }
  ],


  /* =====================================
     RATING DISPLAY

     The ten-star display is prepared here.

     Full rating editing, animations,
     automatic hierarchy averages and
     percentages remain in Step 6.
  ===================================== */

  ratings: {
    minimum: 1,
    maximum: 10,
    increment: 0.5,
    decimalPlaces: 2,
    ignoreUnrated: true,

    starCount: 10,
    showUnratedStars: true
  }

};
