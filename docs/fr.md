# Pont Homebridge

Cette intégration relie Gladys à **votre Homebridge** et propose les
accessoires de tous ses plugins dans l'onglet **Découverte** de Gladys : lampes,
interrupteurs et prises, thermostats et climatiseurs, volets et fenêtres,
ventilateurs, vannes, capteurs et détecteurs, serrures et portes de garage. Une
fois un appareil ajouté, ses valeurs suivent Homebridge **en direct**, et Gladys
le pilote **à travers Homebridge**, qui garde ses plugins (Hue, Tuya, Shelly,
Ring, appareils cloud…). Tout reste sur votre réseau local. Non officiel, sans
lien avec le projet Homebridge ni avec Apple.

Le cœur de Gladys a déjà une intégration HomeKit qui fonctionne dans l'autre
sens (les appareils Gladys dans l'app Maison d'Apple). Celle-ci fait entrer les
accessoires Homebridge **dans** Gladys.

> Développée contre Homebridge 2.4.0 et Homebridge UI 5.29.0 en Docker, avec
> les accessoires virtuels de homebridge-dummy, pas avec du vrai matériel : vos
> retours sont les bienvenus sur le dépôt GitHub.

## Prérequis

- Homebridge avec son interface web (**Homebridge UI**, homebridge-config-ui-x
  5.x), joignable depuis la machine de Gladys (même réseau, ou un VPN).
- Homebridge en **mode insecure** : dans l'interface Homebridge, **Paramètres →
  Homebridge Settings → Homebridge Insecure Mode** (actif par défaut avec
  hb-service), puis redémarrez Homebridge. C'est aussi ce que demande la page
  Accessoires de l'interface : elle lit et pilote les accessoires par le
  protocole HomeKit de vos propres ponts, avec leur code PIN. Tout programme de
  votre réseau qui connaît le PIN peut alors en faire autant, sans appairage
  HomeKit.
- Un **utilisateur de l'interface Homebridge** pour Gladys, sans double
  authentification (un code à usage unique ne peut pas être ressaisi par un
  conteneur). Il n'a pas besoin d'être administrateur : créez un utilisateur
  dédié dans **User Accounts**.

## Configuration

### Adresse et utilisateur

1. Dans l'interface Homebridge, **User Accounts → Add** : un utilisateur
   `gladys`, un mot de passe solide, pas administrateur.
2. Dans Gladys, ouvrez l'intégration, **Configuration** :
   - **Adresse de l'interface Homebridge** : comme `http://192.168.1.40:8581`.
     Pas de nom en `.local`, pas `localhost` : l'intégration tourne dans son
     propre conteneur.
   - **Nom d'utilisateur** et **mot de passe** de cet utilisateur. Laissez-les
     vides si votre interface tourne sans connexion (authentification
     désactivée).
3. Cliquez sur **Tester la connexion** : la version de Homebridge, le nombre
   d'appareils proposés et les services non importés s'affichent.
4. Ouvrez l'onglet **Découverte** et ajoutez les appareils voulus. Leurs valeurs
   sont envoyées dès leur ajout.

### Choisir ce qu'on importe

Gladys propose un appareil par accessoire Homebridge, avec les fonctionnalités
de tous ses services (un capteur température, humidité et batterie forme un seul
appareil).

- **Seulement ces accessoires** : noms séparés par des virgules, `*` remplace
  n'importe quel texte (`Salon*, Garage`). Vide : tous les accessoires.
- **Accessoires à écarter** : jamais importés (`* battery, Test*`).

Un nom correspond au nom de l'accessoire ou à l'un de ses noms de service, sans
tenir compte des majuscules. Seuls les appareils ajoutés dans Gladys reçoivent
des valeurs : les autres ne coûtent rien.

### Serrures, portes de garage et alarmes

Par défaut, les **serrures**, **portes de garage**, **portes motorisées** et
**alarmes (systèmes de sécurité)** sont en **lecture seule** dans Gladys : vous
voyez si elles sont verrouillées, ouvertes ou fermées, mais Gladys ne peut ni
les ouvrir, ni les déverrouiller, ni les désarmer, ni depuis un appareil, ni
depuis une scène, ni depuis un assistant vocal relié à Gladys. Chaque famille a
son propre interrupteur dans la configuration : **Autoriser les commandes des
serrures**, **Autoriser les commandes des portes de garage et motorisées**,
**Autoriser l'armement et le désarmement des alarmes**. N'activez que le
nécessaire : une erreur dans une scène pourrait alors ouvrir votre maison.

### Options

- **Intervalle minimum entre deux valeurs d'un capteur** : un capteur qui publie
  chaque seconde est transmis à ce rythme (10 secondes par défaut).
  Interrupteurs, lampes, volets et détecteurs ne sont jamais retardés.
- **Langue des noms de fonctionnalités** : les suffixes des fonctionnalités
  secondaires (« Luminosité », « Batterie »…). Les noms d'accessoires restent
  ceux de Homebridge.

## Ce que vous obtenez

### Appareils

| Service Homebridge (HAP)                                       | Dans Gladys                                                                            |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Lightbulb                                                      | lampe : marche/arrêt, luminosité, couleur, température de couleur (selon)              |
| Switch, Outlet                                                 | interrupteur marche/arrêt                                                              |
| Fan, Fanv2, AirPurifier, HumidifierDehumidifier                | interrupteur marche/arrêt, vitesse de ventilation (%)                                  |
| Valve, Faucet, IrrigationSystem, Television                    | interrupteur marche/arrêt                                                              |
| Thermostat                                                     | consigne, mode (arrêt, chauffage, climatisation, auto), température actuelle           |
| HeaterCooler                                                   | climatiseur : marche/arrêt, mode, consigne du mode en cours                            |
| WindowCovering, Window                                         | volet : ouvrir, fermer (arrêter si l'accessoire le permet), position                   |
| Door                                                           | position et ouvert ou fermé ; commandes seulement si autorisées                        |
| LockMechanism                                                  | serrure : verrouillée ou non ; commandes seulement si autorisées                       |
| GarageDoorOpener                                               | ouvert ou fermé ; ouvrir/fermer seulement si autorisé                                  |
| Capteurs de température, humidité, luminosité, CO2, PM         | capteurs avec leur unité                                                               |
| Détecteurs de mouvement, présence, ouverture, fuite, fumée, CO | capteurs binaires (une ouverture vaut 0 quand c'est ouvert, comme partout dans Gladys) |
| Batterie, batterie faible, sabotage                            | niveau de batterie, alertes de batterie faible et de sabotage                          |

Les autres services (caméras, haut-parleurs, entrées de TV…) sont listés par le
test de connexion comme « non importés ». L'action de scène ci-dessous atteint
quand même leurs caractéristiques.

### Widget du tableau de bord

Le widget **Homebridge** montre la connexion, la façon dont arrivent les valeurs
(« En direct » par le socket de l'interface, ou « Interrogation »), la version
de Homebridge, les appareils proposés et ajoutés, les services suivis, et un
bouton **Relire** qui relit la liste des accessoires.

### Déclencheurs de scène

- **Bouton Homebridge appuyé** : un interrupteur programmable
  (StatelessProgrammableSwitch) ou une sonnette a été appuyé. Filtres :
  accessoire, appui (simple, double, long). Variables : accessoire, bouton,
  appui. Demande les mises à jour en direct : un appui est un événement,
  l'interrogation ne le voit pas.
- **Alarme Homebridge modifiée** : un système de sécurité a été armé (présent,
  absent, nuit), désarmé ou déclenché. Filtres : alarme, nouvel état.
  Variables : accessoire, état, état précédent.

### Actions de scène

- **Armer ou désarmer une alarme Homebridge** : présent, absent, nuit ou
  désarmer. Demande **Autoriser l'armement et le désarmement des alarmes**. Le
  nom n'est utile que s'il y a plusieurs systèmes de sécurité.
- **Modifier une caractéristique Homebridge** : n'importe quelle caractéristique
  modifiable de n'importe quel accessoire, même non ajouté à Gladys : l'entrée
  d'une TV (`ActiveIdentifier`), l'oscillation d'un ventilateur (`SwingMode`),
  un interrupteur (`On`, `true`). Les noms sont ceux du protocole HomeKit, tels
  que l'interface Homebridge les affiche dans le détail d'un accessoire. Les
  interrupteurs de sécurité s'appliquent ici aussi.

## Exemples de scènes

- Quand le bouton de la sonnette est appuyé (déclencheur), prendre une photo
  avec une caméra et l'envoyer sur votre téléphone.
- Quand l'alarme Homebridge passe à « déclenchée », allumer toutes les lampes et
  envoyer un message.
- À 7 h en semaine, passer l'entrée de la TV du salon sur 3 avec « Modifier une
  caractéristique Homebridge », et la consigne du thermostat à 20 °C.

## Dépannage

- **« Homebridge ne tourne pas en mode insecure »** : activez **Homebridge
  Insecure Mode** dans les réglages de Homebridge et redémarrez Homebridge. Un
  nouvel essai a lieu chaque minute.
- **« Homebridge refuse la connexion »** : vérifiez le nom d'utilisateur et le
  mot de passe ; un utilisateur avec double authentification ne peut pas servir.
  Après 10 échecs en 5 minutes, l'interface bloque le compte 5 minutes :
  l'intégration ne réessaie que toutes les 5 minutes.
- **« Homebridge est injoignable »** : vérifiez l'adresse depuis la machine de
  Gladys (`curl http://<adresse>:8581/api/auth/settings`). Un nouvel essai a
  lieu après 5 secondes, puis jusqu'à chaque minute.
- **Le widget indique « Interrogation »** : le socket de l'interface
  (`/socket.io`) ne passe pas, souvent à cause d'un proxy inverse sans
  WebSocket. Les valeurs arrivent quand même toutes les 30 secondes, les appuis
  de bouton non.
- **Un accessoire manque** : lancez le test de connexion, il liste les services
  non importés. Vérifiez les noms à inclure et à écarter, et que l'accessoire
  apparaît dans la page Accessoires de l'interface Homebridge.
- **Journaux** : mettez `LOG_LEVEL=debug` pour voir chaque valeur reçue.

## Limites

- Développée sans vrai matériel, contre homebridge-dummy : vos retours sont les
  bienvenus.
- Les accessoires Matter de Homebridge 2 ne sont pas importés (l'API REST de
  l'interface ne liste que les accessoires HomeKit).
- Lire la liste demande ses valeurs à chaque accessoire : sans le socket, cela
  arrive toutes les 30 secondes, ce que certains plugins cloud peuvent mal
  supporter.
- Réinitialiser le cache des accessoires de Homebridge (ou changer
  l'identifiant d'un pont) donne de nouveaux identifiants : les appareils sont à
  ajouter de nouveau. Renommer un accessoire, non.
- Les noms des fonctionnalités sont figés à l'ajout de l'appareil dans Gladys.
- Les interrupteurs de sécurité reconnaissent serrures, portes de garage,
  portes motorisées et alarmes par leur type HomeKit : un portail ou une gâche
  qu'un plugin expose comme simple interrupteur reste un interrupteur ordinaire.
  Écartez-le (**Accessoires à écarter** le retire de l'onglet Découverte ;
  l'action de scène peut toujours l'atteindre par son nom).

## Confidentialité

Le pont ne parle qu'à votre interface Homebridge, sur votre réseau. Le mot de
passe est gardé par Gladys dans sa configuration et jamais écrit dans les
journaux ; le jeton de session ne vit qu'en mémoire. Rien n'est envoyé sur
internet.
