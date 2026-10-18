
"use strict";

/*
  WATCH ARCHIVE
  STEP 1C.1 — UNIVERSE DATA

  All positions are world coordinates.
  Group positions are independent from
  the main navigation constellation.

  Real user entries will be stored locally,
  not published inside this file.
*/

window.WATCH_DATA = {

  appName: "Watch Archive",

  version: "1.2.0",

  schemaVersion: 1,

  storageKey: "watch_archive_v1",


  /* =====================================
     STORAGE DEFAULTS
  ===================================== */

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


  /* =====================================
     CAMERA CONFIGURATION
  ===================================== */

  camera: {
    minZoom: 0.12,
    maxZoom: 12,

    initialZoom: 0.75,

    zoomSensitivity: 0.0012,

    transitionDuration: 850,

    tapMovementThreshold: 9
  },


  /* =====================================
     SEMANTIC ZOOM

     Children are revealed by camera zoom,
     rather than switching between pages.

     Each level can also depend on the
     distance from its parent star.
  ===================================== */

  semanticZoom: {

    groupContents: {
      start: 1.15,
      fullyVisible: 1.95
    },

    productionContents: {
      start: 2.5,
      fullyVisible: 3.5
    },

    seasonContents: {
      start: 4.5,
      fullyVisible: 6
    },

    episodeDetails: {
      start: 7,
      fullyVisible: 9
    }

  },


  /* =====================================
     MAIN NAVIGATION CONSTELLATION

     Cassiopeia-inspired irregular pattern.
     Ordered:
     Library → History → Rankings →
     Watchlist → Settings
  ===================================== */

  navigation: {

    id: "main-navigation",

    name: "The Observatory",

    type: "navigation",

    nodes: [

      {
        id: "library",
        title: "Library",
        type: "navigation",
        x: -550,
        y: -75,
        size: 11,
        action: "library"
      },

      {
        id: "history",
        title: "History",
        type: "navigation",
        x: -285,
        y: 70,
        size: 9,
        action: "history"
      },

      {
        id: "rankings",
        title: "Rankings",
        type: "navigation",
        x: -35,
        y: -190,
        size: 12,
        action: "rankings"
      },

      {
        id: "watchlist",
        title: "Watchlist",
        type: "navigation",
        x: 250,
        y: 15,
        size: 10,
        action: "watchlist"
      },

      {
        id: "settings",
        title: "Settings",
        type: "navigation",
        x: 550,
        y: -275,
        size: 11,
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
     GROUP CONSTELLATION SPREAD

     Real groups will be assigned positions
     scattered through the surrounding sky.
  ===================================== */

  groupPlacement: {

    minimumDistanceFromNavigation: 950,

    minimumDistanceBetweenGroups: 650,

    preferredDistance: 1500,

    outerRadius: 16000,

    layoutSeed: 73129

  },


  /* =====================================
     DEMONSTRATION GROUPS

     These are purely visual test objects.
     They are NOT added to personal storage.

     They can be removed automatically once
     the real archive editor is implemented.
  ===================================== */

  demoGroups: [

    {
      id: "demo-asoiaf",
      title: "A Song of Ice and Fire",
      type: "group",
      demo: true,

      x: 1550,
      y: -950,

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
                },
                {
                  id: "demo-got-e3",
                  title: "Lord Snow",
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
          children: []
        }

      ]

    },


    {
      id: "demo-harrypotter",
      title: "Harry Potter",
      type: "group",
      demo: true,

      x: -1900,
      y: -1250,

      children: [

        {
          id: "demo-hp1",
          title: "Philosopher's Stone",
          type: "production",
          children: []
        },

        {
          id: "demo-hp2",
          title: "Chamber of Secrets",
          type: "production",
          children: []
        },

        {
          id: "demo-hp3",
          title: "Prisoner of Azkaban",
          type: "production",
          children: []
        }

      ]

    },


    {
      id: "demo-starwars",
      title: "Star Wars",
      type: "group",
      demo: true,

      x: 2400,
      y: 1200,

      children: [

        {
          id: "demo-sw1",
          title: "A New Hope",
          type: "production",
          children: []
        },

        {
          id: "demo-sw2",
          title: "The Empire Strikes Back",
          type: "production",
          children: []
        },

        {
          id: "demo-sw3",
          title: "Return of the Jedi",
          type: "production",
          children: []
        }

      ]

    }

  ],


  /* =====================================
     PRODUCTION LIBRARY RULES

     The main navigation does NOT list
     groups, seasons, or episodes.
  ===================================== */

  libraryViews: {

    library: {
      entityType: "production",
      sortBy: "title",
      direction: "asc"
    },

    history: {
      entityType: "production",
      sortBy: "lastWatched",
      direction: "desc"
    },

    rankings: {
      entityType: "production",
      sortBy: "averageRating",
      direction: "desc"
    },

    watchlist: {
      entityType: "production",
      filterBy: "watchlist",
      direction: "asc"
    }

  },


  /* =====================================
     MEDIA TYPES & STATUSES
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

  ratings: {
    minimum: 1,
    maximum: 10,
    increment: 0.5
  }

};
