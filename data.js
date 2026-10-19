"use strict";

window.WATCH_DATA = {
  appName: "Watch Archive",
  version: "4.2.0",

  schemaVersion: 1,
  storageKey: "watch_archive_v1",

  defaults: {
    settings: {
      starDensity: 75,
      starBrightness: 60,
      nebulaIntensity: 68,
      constellationGlow: 68,
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
    defaultOpacity: 82
  },

  camera: {
    minZoom: 0.10,
    maxZoom: 24,
    initialZoom: 0.8,
    wheelSensitivity: 0.0011,
    pinchSensitivity: 1,
    travelDuration: 950,
    tapThreshold: 10,
    smoothness: 0.16
  },

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

  appearance: {
    navigationStars: {
      radius: 4.7,
      glow: 35,
      color: [226, 230, 255]
    },

    groupStars: {
      radius: 2.1,
      glow: 15,
      color: [196, 192, 243]
    },

    productionStars: {
      radius: 2.65,
      glow: 18,
      color: [193, 206, 255]
    },

    seasonStars: {
      radius: 2.0,
      glow: 14,
      color: [203, 205, 246]
    },

    episodeStars: {
      radius: 1.6,
      glow: 10,
      color: [201, 211, 242]
    },

    lineOpacity: 0.23,
    activeLineOpacity: 0.64
  },

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

  groupPlacement: {
    initialRadius: 1450,
    minimumSpacing: 750,
    distanceGrowth: 350,
    angleOffset: -0.62,
    seed: 73129
  },

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

  detailPopup: {
    mode: "popup",

    dimensions: {
      desktopWidth: 1000,
      desktopHeight: 780,
      mobileInset: 8
    },

    notes: {
      minHeight: 116,
      maxHeight: 140
    },

    childLayouts: {
      group: "horizontal",
      production: "vertical",
      season: "grid",
      episode: "none"
    },

    scrollRules: {
      popupScrollable: false,
      notesScrollable: false,
      childSectionsOnly: true
    }
  },

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
