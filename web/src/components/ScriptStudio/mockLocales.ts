// Locale bundles as they would arrive from each script.
//
// In game dirk_lib asks every registered resource for its bundle in the active
// language (its own locales/<lang>.json, `settings.*` namespace) and hands them
// to the panel keyed by resource. Only a handful are translated here on purpose
// - the rest fall through to the schema's English, which is exactly what a
// part-translated script looks like on a real server.

import type { LocaleBundles } from './studioLocale';

// projectCars' REAL bundle, not a hand-written sample.
//
// Its schema is where the newest annotations land, and a hand-copied handful
// of keys meant the browser showed prettified schema English while the game
// showed the translation - so the one place the panel gets looked at before
// it ships was the one place that could not show a missing key.
import projectCarsEn from './fixtures/dirk_projectCars.en.json';

export const MOCK_LOCALES: LocaleBundles = {
  dirk_projectCars: { en: projectCarsEn as Record<string, string> },
  dirk_fishing: {
    en: {
      'sections.general.label': 'General',
      'settings.basic.debug.label': 'Debug Mode',
      'settings.basic.debug.description': 'Enables debug logging and bypasses the rod setup requirement.',
      'settings.basic.weightUnit.label': 'Weight Unit',
      'settings.basic.timeToCast.label': 'Time To Cast',
    },
    fr: {
      'sections.general.label': 'Général',
      'sections.theme.label': 'Thème',
      'sections.casting.label': 'Lancer',
      'sections.progression.label': 'Progression',
      'sections.fish.label': 'Poissons',
      'sections.equipment.label': 'Équipement',
      'sections.anchor.label': 'Ancre',
      'sections.fishfinder.label': 'Détecteur de poissons',
      'sections.traps.label': 'Casiers',
      'sections.gutting.label': 'Découpe',
      'sections.permits.label': 'Permis',
      'sections.items.label': 'Objets',
      'sections.baitDig.label': "Recherche d'appâts",
      'sections.zones.label': 'Zones de pêche',
      'sections.stores.label': 'Boutiques',
      'sections.tournaments.label': 'Tournois',
      'sections.dailyChallenges.label': 'Défis quotidiens',
      'sections.logging.label': 'Journalisation',
      'sections.general.description': 'Comportement global et unités.',
      'settings.basic.debug.label': 'Mode débogage',
      'settings.basic.debug.description': "Active la journalisation et ignore la configuration de la canne.",
      'settings.basic.weightUnit.label': 'Unité de poids',
      'settings.basic.distanceUnit.label': 'Unité de distance',
      'settings.basic.timeToCast.label': 'Temps de lancer',
      'settings.basic.timeToCast.description': "Durée de charge d'un lancer complet.",
      'settings.fish.label': 'Espèces',
    },
    de: {
      'sections.general.label': 'Allgemein',
      'sections.theme.label': 'Design',
      'sections.casting.label': 'Auswerfen',
      'sections.progression.label': 'Fortschritt',
      'sections.fish.label': 'Fische',
      'sections.equipment.label': 'Ausrüstung',
      'sections.anchor.label': 'Anker',
      'sections.fishfinder.label': 'Fischfinder',
      'sections.traps.label': 'Reusen',
      'sections.gutting.label': 'Ausnehmen',
      'sections.permits.label': 'Angelscheine',
      'sections.items.label': 'Gegenstände',
      'sections.baitDig.label': 'Ködergraben',
      'sections.zones.label': 'Angelzonen',
      'sections.stores.label': 'Läden',
      'sections.tournaments.label': 'Turniere',
      'sections.dailyChallenges.label': 'Tagesaufgaben',
      'sections.logging.label': 'Protokollierung',
      'settings.basic.debug.label': 'Debug-Modus',
      'settings.basic.debug.description': 'Aktiviert Debug-Logs und überspringt die Ruten-Einrichtung.',
      'settings.basic.weightUnit.label': 'Gewichtseinheit',
      'settings.basic.timeToCast.label': 'Auswurfzeit',
    },
  },

  dirk_lib: {
    en: {},
    fr: {
      'sections.basic.label': 'Général',
      'sections.appearance.label': 'Apparence',
      'sections.groups.label': 'Groupes',
      'sections.discord.label': 'Discord',
      'sections.logger.label': 'Protokoll',
      'sections.advanced.label': 'Avancé',
      'sections.bridging.label': 'Connexions',
      'settings.appearance.language.label': 'Langue',
      'settings.appearance.language.description': "S'applique immédiatement — aucun redémarrage.",
      'settings.appearance.primaryColor.label': 'Couleur principale',
    },
    de: {
      'sections.basic.label': 'Allgemein',
      'sections.appearance.label': 'Darstellung',
      'sections.groups.label': 'Gruppen',
      'sections.discord.label': 'Discord',
      'sections.logger.label': 'Protokollierung',
      'sections.advanced.label': 'Erweitert',
      'sections.bridging.label': 'Verbindungen',
      'settings.appearance.language.label': 'Sprache',
      'settings.appearance.primaryColor.label': 'Primärfarbe',
    },
  },
};
