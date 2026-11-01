
/* ==========================================
   GEM LIBRARY — DATA.JS
========================================== */

"use strict";

const GEM_DATA = {

  storageKey: "gem-family-atlas-v1",

  version: 1,

  classifications: [
    "Semi Precious",
    "Precious",
    "Organic",
    "Minerals",
    "Mineraloids",
    "Natural Gem",
    "Synthetic"
  ],

  rarities: [
    "Common",
    "Uncommon",
    "Rare",
    "Very Rare"
  ],

  mohs: [
    0, 0.5, 1, 1.5, 2, 2.5,
    3, 3.5, 4, 4.5, 5, 5.5,
    6, 6.5, 7, 7.5, 8, 8.5,
    9, 9.5, 10
  ],

  crystalSystems: [
    "Cubic",
    "Tetragonal",
    "Hexagonal",
    "Trigonal",
    "Orthorhombic",
    "Monoclinic",
    "Triclinic"
  ],

  transparencies: [
    "Transparent",
    "Translucent",
    "Opaque",
    "Variable"
  ],

  symbols: [
    "◆",
    "◇",
    "✦",
    "✧",
    "◈",
    "⬡",
    "❖"
  ],

  relationshipTypes: {

    parent: {
      label: "Parent → Child",
      shortLabel: "Parent",
      symbol: "↓",
      color: "#d2b584",
      directional: true,
      genealogical: true,
      explanation:
        "The first gemstone is the parent of the second. " +
        "This connection contributes to ancestry, siblings, " +
        "cousins and generation calculations."
    },

    adoptive: {
      label: "Adoptive Parent → Child",
      shortLabel: "Adoptive Parent",
      symbol: "⇣",
      color: "#b9a57b",
      directional: true,
      genealogical: true,
      explanation:
        "The first gemstone is an adoptive parent of the second. " +
        "The connection contributes to the family genealogy."
    },

    sibling: {
      label: "Sibling ↔ Sibling",
      shortLabel: "Sibling",
      symbol: "=",
      color: "#7faace",
      directional: false,
      genealogical: false,
      explanation:
        "The two gemstones are manually designated siblings. " +
        "The relationship is displayed directly; to derive " +
        "cousins and ancestral relatives, connect their parents."
    },

    partner: {
      label: "Partner / Lover",
      shortLabel: "Partner",
      symbol: "♡",
      color: "#d291ab",
      directional: false,
      genealogical: false,
      explanation:
        "Creates a mutual romantic or partner relationship. " +
        "Partners do not automatically become parents of " +
        "each other's children."
    },

    guardian: {
      label: "Guardian → Ward",
      shortLabel: "Guardian",
      symbol: "✧",
      color: "#85c3ba",
      directional: true,
      genealogical: false,
      explanation:
        "The first gemstone acts as guardian of the second. " +
        "This relationship does not create ancestry."
    },

    family: {
      label: "Family Bound / Family Group",
      shortLabel: "Family Bound",
      symbol: "◇",
      color: "#9eae86",
      directional: false,
      genealogical: false,
      explanation:
        "Groups two gemstones in the same chosen family or " +
        "lineage without defining a parent-child relationship."
    },

    associated: {
      label: "Related / Associated",
      shortLabel: "Associated",
      symbol: "⋯",
      color: "#a59ccb",
      directional: false,
      genealogical: false,
      explanation:
        "Creates a general connection. Useful for mineral " +
        "associations, symbolic bonds and other relationships."
    }

  },

  defaultSettings: {
    showLines: true,
    showDetails: true,
    snapGrid: false,
    curvedLines: true
  },

  /* ------------------------------------------
     DEMONSTRATION DATA
     All genealogies here are illustrative.
  ------------------------------------------ */

  createDemo() {

    const now = Date.now();

    return {
      version: 1,

      settings: {
        ...this.defaultSettings
      },

      gems: [

        {
          id: "demo-1",
          name: "Corundum",
          title: "The Elder Crystal",
          classifications: ["Minerals"],
          mineralRarity: "Common",
          gemRarity: "Uncommon",
          mohs: 9,
          crystalSystem: "Trigonal",
          color: "Various",
          transparency: "Variable",
          accent: "#c8a7bd",
          symbol: "⬡",
          notes: "Illustrative genealogy. Corundum is the mineral species associated with ruby and sapphire varieties.",
          x: 40,
          y: -170,
          createdAt: now,
          updatedAt: now
        },

        {
          id: "demo-2",
          name: "Ruby",
          title: "The Crimson Heir",
          classifications: ["Precious", "Natural Gem"],
          mineralRarity: "Uncommon",
          gemRarity: "Rare",
          mohs: 9,
          crystalSystem: "Trigonal",
          color: "Red",
          transparency: "Transparent",
          accent: "#dc647d",
          symbol: "◆",
          notes: "Red gem variety of corundum.",
          x: -190,
          y: 40,
          createdAt: now,
          updatedAt: now
        },

        {
          id: "demo-3",
          name: "Sapphire",
          title: "The Celestial Stone",
          classifications: ["Precious", "Natural Gem"],
          mineralRarity: "Uncommon",
          gemRarity: "Rare",
          mohs: 9,
          crystalSystem: "Trigonal",
          color: "Blue",
          transparency: "Transparent",
          accent: "#628edb",
          symbol: "◈",
          notes: "Sapphire is another gem variety of corundum.",
          x: 240,
          y: 40,
          createdAt: now,
          updatedAt: now
        },

        {
          id: "demo-4",
          name: "Garnet",
          title: "The Ember Heart",
          classifications: ["Semi Precious", "Natural Gem"],
          mineralRarity: "Common",
          gemRarity: "Uncommon",
          mohs: 7,
          crystalSystem: "Cubic",
          color: "Deep Red",
          transparency: "Transparent",
          accent: "#b8626d",
          symbol: "✦",
          notes: "Example of an associated gemstone.",
          x: -190,
          y: 265,
          createdAt: now,
          updatedAt: now
        },

        {
          id: "demo-5",
          name: "Amethyst",
          title: "The Violet Dream",
          classifications: ["Semi Precious", "Natural Gem"],
          mineralRarity: "Common",
          gemRarity: "Common",
          mohs: 7,
          crystalSystem: "Trigonal",
          color: "Purple",
          transparency: "Transparent",
          accent: "#b094e6",
          symbol: "✧",
          notes: "Purple quartz variety.",
          x: 240,
          y: 265,
          createdAt: now,
          updatedAt: now
        }

      ],

      connections: [

        {
          id: "demo-link-1",
          a: "demo-1",
          b: "demo-2",
          type: "parent",
          notes: "Illustrative family-tree connection.",
          createdAt: now
        },

        {
          id: "demo-link-2",
          a: "demo-1",
          b: "demo-3",
          type: "parent",
          notes: "Illustrative family-tree connection.",
          createdAt: now
        },

        {
          id: "demo-link-3",
          a: "demo-2",
          b: "demo-4",
          type: "associated",
          notes: "Custom association.",
          createdAt: now
        },

        {
          id: "demo-link-4",
          a: "demo-3",
          b: "demo-5",
          type: "associated",
          notes: "Custom association.",
          createdAt: now
        }

      ]

    };
  },

  createEmpty() {
    return {
      version: 1,
      settings: {
        ...this.defaultSettings
      },
      gems: [],
      connections: []
    };
  },

  createGem() {
    return {
      id: "",
      name: "",
      title: "",
      classifications: [],
      mineralRarity: "",
      gemRarity: "",
      mohs: "",
      crystalSystem: "",
      color: "",
      transparency: "",
      accent: "#a7a6d2",
      symbol: "◆",
      notes: "",
      x: 0,
      y: 0,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
  }

};
