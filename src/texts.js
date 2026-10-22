// -----------------------------------------------------------------------------
// Every text the container produces, in the four languages of the Gladys
// interface. German says "du", Spanish "usted" (test/i18n.test.js).
// Homebridge, HomeKit and accessory names are never translated.
// -----------------------------------------------------------------------------

/** Suffixes of the secondary features of a service ("Ceiling lamp – Brightness"). */
export const ROLE_NAMES = {
  en: {
    on: 'On/off',
    active: 'On/off',
    brightness: 'Brightness',
    color: 'Colour',
    color_temperature: 'Colour temperature',
    speed: 'Speed',
    target: 'Set point',
    mode: 'Mode',
    state: 'Open/close',
    command: 'Open/close',
    position: 'Position',
    contact: 'Open or closed',
    temperature: 'Temperature',
    humidity: 'Humidity',
    light: 'Light level',
    co2: 'CO2',
    pm25: 'PM2.5',
    pm10: 'PM10',
    battery: 'Battery',
    low_battery: 'Low battery',
    motion: 'Motion',
    occupancy: 'Presence',
    leak: 'Leak',
    smoke: 'Smoke',
    co: 'Carbon monoxide',
    tamper: 'Tampering',
  },
  fr: {
    on: 'Marche/arrêt',
    active: 'Marche/arrêt',
    brightness: 'Luminosité',
    color: 'Couleur',
    color_temperature: 'Température de couleur',
    speed: 'Vitesse',
    target: 'Consigne',
    mode: 'Mode',
    state: 'Ouvrir/fermer',
    command: 'Ouvrir/fermer',
    position: 'Position',
    contact: 'Ouvert ou fermé',
    temperature: 'Température',
    humidity: 'Humidité',
    light: 'Luminosité ambiante',
    co2: 'CO2',
    pm25: 'PM2,5',
    pm10: 'PM10',
    battery: 'Batterie',
    low_battery: 'Batterie faible',
    motion: 'Mouvement',
    occupancy: 'Présence',
    leak: 'Fuite',
    smoke: 'Fumée',
    co: 'Monoxyde de carbone',
    tamper: 'Sabotage',
  },
  de: {
    on: 'Ein/Aus',
    active: 'Ein/Aus',
    brightness: 'Helligkeit',
    color: 'Farbe',
    color_temperature: 'Farbtemperatur',
    speed: 'Geschwindigkeit',
    target: 'Sollwert',
    mode: 'Modus',
    state: 'Öffnen/Schließen',
    command: 'Öffnen/Schließen',
    position: 'Position',
    contact: 'Offen oder geschlossen',
    temperature: 'Temperatur',
    humidity: 'Luftfeuchtigkeit',
    light: 'Helligkeit (Umgebung)',
    co2: 'CO2',
    pm25: 'PM2,5',
    pm10: 'PM10',
    battery: 'Batterie',
    low_battery: 'Batterie schwach',
    motion: 'Bewegung',
    occupancy: 'Anwesenheit',
    leak: 'Leck',
    smoke: 'Rauch',
    co: 'Kohlenmonoxid',
    tamper: 'Manipulation',
  },
  es: {
    on: 'Encendido/apagado',
    active: 'Encendido/apagado',
    brightness: 'Brillo',
    color: 'Color',
    color_temperature: 'Temperatura de color',
    speed: 'Velocidad',
    target: 'Consigna',
    mode: 'Modo',
    state: 'Abrir/cerrar',
    command: 'Abrir/cerrar',
    position: 'Posición',
    contact: 'Abierto o cerrado',
    temperature: 'Temperatura',
    humidity: 'Humedad',
    light: 'Luz ambiente',
    co2: 'CO2',
    pm25: 'PM2,5',
    pm10: 'PM10',
    battery: 'Batería',
    low_battery: 'Batería baja',
    motion: 'Movimiento',
    occupancy: 'Presencia',
    leak: 'Fuga',
    smoke: 'Humo',
    co: 'Monóxido de carbono',
    tamper: 'Manipulación',
  },
};

/** Connection statuses (Configuration screen, widget). */
export const STATUS = {
  not_configured: {
    en: 'Type the address of the Homebridge UI.',
    fr: "Saisissez l'adresse de l'interface Homebridge.",
    de: 'Gib die Adresse der Homebridge-Oberfläche ein.',
    es: 'Escriba la dirección de la interfaz de Homebridge.',
  },
  invalid_url: {
    en: 'The address of Homebridge is not valid (example: http://192.168.1.40:8581).',
    fr: "L'adresse de Homebridge n'est pas valide (exemple : http://192.168.1.40:8581).",
    de: 'Die Adresse von Homebridge ist ungültig (Beispiel: http://192.168.1.40:8581).',
    es: 'La dirección de Homebridge no es válida (ejemplo: http://192.168.1.40:8581).',
  },
  auth_failed: {
    en: 'Homebridge refused the login: check the user name and password (two-factor authentication is not supported).',
    fr: "Homebridge refuse la connexion : vérifiez le nom d'utilisateur et le mot de passe (la double authentification n'est pas prise en charge).",
    de: 'Homebridge verweigert die Anmeldung: Prüfe Benutzername und Passwort (Zwei-Faktor-Authentifizierung wird nicht unterstützt).',
    es: 'Homebridge rechaza el inicio de sesión: compruebe el usuario y la contraseña (la autenticación de dos factores no es compatible).',
  },
  insecure_off: {
    en: 'Homebridge does not run in insecure mode: enable it (Homebridge settings) to control the accessories.',
    fr: 'Homebridge ne tourne pas en mode insecure : activez-le (réglages de Homebridge) pour piloter les accessoires.',
    de: 'Homebridge läuft nicht im Insecure-Modus: Aktiviere ihn (Homebridge-Einstellungen), um die Zubehöre zu steuern.',
    es: 'Homebridge no funciona en modo insecure: actívelo (ajustes de Homebridge) para controlar los accesorios.',
  },
  unreachable: {
    en: 'Homebridge is unreachable, new attempt in a moment.',
    fr: 'Homebridge est injoignable, nouvel essai dans un instant.',
    de: 'Homebridge ist nicht erreichbar, neuer Versuch gleich.',
    es: 'Homebridge no está accesible, nuevo intento en un momento.',
  },
};

/** Errors returned to Gladys (command toasts, scene action logs). */
export const ERRORS = {
  offline: {
    en: 'Homebridge is not connected.',
    fr: "Homebridge n'est pas connecté.",
    de: 'Homebridge ist nicht verbunden.',
    es: 'Homebridge no está conectado.',
  },
  unknown_feature: {
    en: 'This feature is no longer offered by Homebridge: scan again.',
    fr: "Cette fonctionnalité n'est plus proposée par Homebridge : relancez une recherche.",
    de: 'Diese Funktion bietet Homebridge nicht mehr an: Suche erneut.',
    es: 'Homebridge ya no ofrece esta función: vuelva a buscar.',
  },
  security_disabled: {
    en: 'Commands of locks, garage doors and alarms are disabled in the configuration.',
    fr: 'Les commandes des serrures, portes de garage et alarmes sont désactivées dans la configuration.',
    de: 'Befehle für Schlösser, Garagentore und Alarmanlagen sind in der Konfiguration deaktiviert.',
    es: 'Los comandos de cerraduras, puertas de garaje y alarmas están desactivados en la configuración.',
  },
  out_of_range: {
    en: 'Value outside the limits Homebridge gives for this accessory.',
    fr: 'Valeur hors des limites que Homebridge donne pour cet accessoire.',
    de: 'Wert außerhalb der Grenzen, die Homebridge für dieses Zubehör angibt.',
    es: 'Valor fuera de los límites que Homebridge indica para este accesorio.',
  },
  unsupported_value: {
    en: 'This accessory does not offer this value.',
    fr: 'Cet accessoire ne propose pas cette valeur.',
    de: 'Dieses Zubehör bietet diesen Wert nicht an.',
    es: 'Este accesorio no ofrece este valor.',
  },
  bad_accessory: {
    en: 'Write the name of the accessory, as in Homebridge.',
    fr: "Écrivez le nom de l'accessoire, comme dans Homebridge.",
    de: 'Schreibe den Namen des Zubehörs, wie in Homebridge.',
    es: 'Escriba el nombre del accesorio, como en Homebridge.',
  },
  not_found: {
    en: 'Homebridge has no accessory of this name: ',
    fr: "Homebridge n'a pas d'accessoire de ce nom : ",
    de: 'Homebridge hat kein Zubehör mit diesem Namen: ',
    es: 'Homebridge no tiene ningún accesorio con este nombre: ',
  },
  ambiguous: {
    en: 'Several accessories have this name, make it unique in Homebridge: ',
    fr: 'Plusieurs accessoires portent ce nom, rendez-le unique dans Homebridge : ',
    de: 'Mehrere Zubehöre tragen diesen Namen, mach ihn in Homebridge eindeutig: ',
    es: 'Varios accesorios tienen este nombre, hágalo único en Homebridge: ',
  },
  bad_characteristic: {
    en: 'This accessory has no writable characteristic of this name, for example On or TargetPosition.',
    fr: "Cet accessoire n'a pas de caractéristique modifiable de ce nom, par exemple On ou TargetPosition.",
    de: 'Dieses Zubehör hat keine schreibbare Eigenschaft mit diesem Namen, zum Beispiel On oder TargetPosition.',
    es: 'Este accesorio no tiene ninguna característica modificable con este nombre, por ejemplo On o TargetPosition.',
  },
  bad_value: {
    en: 'Write the value to set: true, false or a number.',
    fr: 'Écrivez la valeur à donner : true, false ou un nombre.',
    de: 'Schreibe den zu setzenden Wert: true, false oder eine Zahl.',
    es: 'Escriba el valor a establecer: true, false o un número.',
  },
  no_alarm: {
    en: 'Homebridge has no alarm (security system) of this name.',
    fr: "Homebridge n'a pas d'alarme (système de sécurité) de ce nom.",
    de: 'Homebridge hat keine Alarmanlage (Sicherheitssystem) mit diesem Namen.',
    es: 'Homebridge no tiene ninguna alarma (sistema de seguridad) con este nombre.',
  },
  refused: {
    en: 'Homebridge refused the command: ',
    fr: 'Homebridge a refusé la commande : ',
    de: 'Homebridge hat den Befehl abgelehnt: ',
    es: 'Homebridge rechazó el comando: ',
  },
};

/** Words of the widget. */
export const WORDS = {
  en: {
    connected: 'Connected',
    unreachable: 'Unreachable',
    not_configured: 'Not configured',
    auth_failed: 'Login refused',
    insecure_off: 'Insecure mode off',
    connecting: 'Connecting',
    version: 'Version',
    connection: 'Connection',
    live: 'Live updates',
    live_on: 'Socket',
    live_off: 'Polling',
    offered: 'Devices offered',
    added: 'Devices added',
    followed: 'Services followed',
    reload: 'Reload',
    reloaded: 'Accessory list read again.',
  },
  fr: {
    connected: 'Connecté',
    unreachable: 'Injoignable',
    not_configured: 'Non configuré',
    auth_failed: 'Connexion refusée',
    insecure_off: 'Mode insecure désactivé',
    connecting: 'Connexion',
    version: 'Version',
    connection: 'Connexion',
    live: 'Mises à jour',
    live_on: 'En direct',
    live_off: 'Interrogation',
    offered: 'Appareils proposés',
    added: 'Appareils ajoutés',
    followed: 'Services suivis',
    reload: 'Relire',
    reloaded: 'Liste des accessoires relue.',
  },
  de: {
    connected: 'Verbunden',
    unreachable: 'Nicht erreichbar',
    not_configured: 'Nicht konfiguriert',
    auth_failed: 'Anmeldung verweigert',
    insecure_off: 'Insecure-Modus aus',
    connecting: 'Verbinde',
    version: 'Version',
    connection: 'Verbindung',
    live: 'Aktualisierung',
    live_on: 'Live',
    live_off: 'Abfrage',
    offered: 'Angebotene Geräte',
    added: 'Hinzugefügte Geräte',
    followed: 'Verfolgte Dienste',
    reload: 'Neu laden',
    reloaded: 'Zubehörliste neu gelesen.',
  },
  es: {
    connected: 'Conectado',
    unreachable: 'No accesible',
    not_configured: 'Sin configurar',
    auth_failed: 'Inicio rechazado',
    insecure_off: 'Modo insecure desactivado',
    connecting: 'Conectando',
    version: 'Versión',
    connection: 'Conexión',
    live: 'Actualizaciones',
    live_on: 'En directo',
    live_off: 'Consulta periódica',
    offered: 'Dispositivos ofrecidos',
    added: 'Dispositivos añadidos',
    followed: 'Servicios seguidos',
    reload: 'Recargar',
    reloaded: 'Lista de accesorios releída.',
  },
};

/**
 * The message of the "Test the connection" action.
 * @param {object} r { version, devices, services, ignored: [[reason, count]] }
 */
export function testMessage({ version, devices, services, ignored }) {
  const list = ignored
    .slice(0, 8)
    .map(([reason, count]) => `${reason} (${count})`)
    .join(', ');
  const none = { en: 'none', fr: 'aucun', de: 'keine', es: 'ninguno' };
  const rest = (lang) => list || none[lang];
  const v = version ? ` ${version}` : '';
  return {
    en: `Connected to Homebridge${v}: ${devices} devices offered (${services} services). Not imported: ${rest('en')}.`,
    fr: `Connecté à Homebridge${v} : ${devices} appareils proposés (${services} services). Non importés : ${rest('fr')}.`,
    de: `Mit Homebridge${v} verbunden: ${devices} Geräte angeboten (${services} Dienste). Nicht importiert: ${rest('de')}.`,
    es: `Conectado a Homebridge${v}: ${devices} dispositivos ofrecidos (${services} servicios). No importados: ${rest('es')}.`,
  };
}

/** An Error whose message is in the configured language, with the four kept for tests. */
export function localizedError(text, language, detail = '') {
  const err = new Error(`${text[language] ?? text.en}${detail}`);
  err.texts = text;
  return err;
}
