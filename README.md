# Vacuum Map Card

This card allows you to specify a target, initiate a cleaning by zones, defined zones or rooms using a live or static map, as in your vacuum cleaner application. Additionally, you can define cleaning repeats.

To be able to use this card with any robot vacuum cleaner integrated in Home Assistant, this card executes a service that you want, for example a script. The card will send some parameters that you can use in your script.

This project is a modification of the [PiotrMachowski](https://github.com/PiotrMachowski/lovelace-xiaomi-vacuum-map-card) project that I have adapted to my needs.

## Go to target
![Go to target](https://github.com/fjramirez1987/vacuum-map-card/blob/master/media/a1.gif)

## Zoned cleanup
![Zoned cleanup](https://github.com/fjramirez1987/vacuum-map-card/blob/master/media/a2.gif)

## Defined zones
![Defined zones](https://github.com/fjramirez1987/vacuum-map-card/blob/master/media/a3.gif)

## Rooms
![Rooms](https://github.com/fjramirez1987/vacuum-map-card/blob/master/media/a4.gif)

## Configuration options

| Key | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `entity` | `string` | `True` | - | ID of vacuum entity |
| `map_image` | `string` | `False` | - | Path to image of map |
| `map_camera` | `string` | `False` | - | ID of map camera entity (for map without root on a vacuum use [this](https://github.com/PiotrMachowski/Home-Assistant-custom-components-Xiaomi-Cloud-Map-Extractor) integration) |
| `camera_refresh_interval` | `integer` | `False` | 5 | Update interval for map camera in seconds |
| `camera_calibration` | `boolean` | `False` | - | Automatic calibration if camera entity provides `calibration_points` attribute |
| `calibration_points` | `list` | `False` | - | Pairs of coordinates: in vacuum system and on map image. See: [Calibration](#calibration)  |
| `zones` | `list` | `False` | Empty | List of predefined zones |
| `rooms` | `list` | `False` | Empty | List of id rooms |
| `modes` | `list` | `False` | `[go_to_target, zoned_cleanup, predefined_zones, rooms_cleanup]` | List of displayed modes. Possible values: `go_to_target`, `zoned_cleanup`, `predefined_zones`, `rooms_cleanup` |
| `default_mode` | `string` | `False` | - | Default selected mode. Possible values: `go_to_target`, `zoned_cleanup`, `predefined_zones` |
| `debug` | `boolean` | `False` | `false` | Enables alerts with coordinates after holding `Start` button. Possible values: `true`, `false` |
| `service_start` | `string` | `False` | `script.vacuum_start` | Allows to define service used after clicking `Start` button. See: [Defining service_start](#defining-service-start) |
| `service_return` | `string` | `False` | `script.vacuum_return_to_base` | Allows to define service used after clicking `Return` button. See: [Defining service_return](#defining-service-return-to-base) |
| `language` | `string` | `False` | `en` | Language used in the card. Possible values: `cz`, `en`, `de`, `dk`, `es`, `fi`, `fr`, `hu`, `it`, `nl`, `no`, `pl`, `pt`, `ru`, `se`, `sk`, `uk` |

## Example usage:
```yaml
type: custom:xiaomi-vacuum-map-card
entity: vacuum.xiaomi_vacuum
map_image: '/local/custom_lovelace/xiaomi_vacuum_map_card/map.png'
calibration_points:
  - vacuum:
      x: 25500
      y: 25500
    map:
      x: 466
      y: 1889
  - vacuum:
      x: 26500
      y: 26500
    map:
      x: 730
      y: 1625
  - vacuum:
      x: 25500
      y: 26500
    map:
      x: 466
      y: 1625
zones:
  - [[25500, 25500, 26500, 26500]]
  - [[24215, 28125, 29465, 32175]]
  - [[24245, 25190, 27495, 27940], [27492, 26789, 28942, 27889]]
  - [[28972, 26715, 31072, 27915], [29457, 27903, 31107, 29203], [30198, 29215, 31498, 31215], [29461, 31228, 31511, 32478]]
```

## Installation


### Using HACS (recommended)
This card can be installed using [HACS](https://hacs.xyz). Add this repository `https://github.com/fjramirez1987/vacuum-map-card` as a custom repository in HACS.

### Manual

Download all the files from [https://github.com/fjramirez1987/vacuum-map-card/tree/master/dist](https://github.com/fjramirez1987/vacuum-map-card/tree/master/dist) to the `/www/custom_lovelace/vacuum_map_card` directory of your Home Assistant.

## Calibration
You must indicate in some way that the coordinates of a point on your map correspond to a point in your physical space. This is known as converting pixels to meters.

This is highly dependent on your robot and you will need to do some tests to determine the relationship between pixels on your map and the coordinate values your robot interprets (the value is not always meters). I know it is not something simple.

### With Xiaomi Cloud Map Extractor (recommended)
If you use the [With Xiaomi Cloud Map Extractor](https://github.com/PiotrMachowski/Home-Assistant-custom-components-Xiaomi-Cloud-Map-Extractor) integration to extract your map, your card is automatically calibrated by adding the following settings:

- `calibration_points` in [camera configuration](https://github.com/PiotrMachowski/Home-Assistant-custom-components-Xiaomi-Cloud-Map-Extractor#attributes-configuration).
- `camera_calibration: true` in card configuration.

Example configuration:
```yaml
type: custom:vacuum-map-card
entity: vacuum.xiaomi_vacuum
map_camera: camera.xiaomi_cloud_map_extractor
camera_calibration: true
```
### Xiaomi Home (manual)

1. Open map view in Xiaomi Home
2. Open dev tools in Home Assistant
3. Call service `vacuum.send_command` with different parameters to estimate your vacuums coordinates system. Point [25500, 25500] is usually very close to the docking station, difference of 1000 translates to 1 meter distance. If your vacuum is unable to get to a desired point try changing coordinates in the opposite way.
4. Estimate coordinates of a zone that will cover a whole map
Call service `xiaomi_miio.vacuum_clean_zone` with estimated coordinates
5. Take a screenshot of a map with a marked zone

[Here](https://hackernoon.com/how-i-set-up-room-cleaning-automation-with-google-home-home-assistant-and-xiaomi-vacuum-cleaner-9149e0267e6d) is a pretty good explanation how to find out coordinates for different points on the map. There is just one mistake: [25500, 25500] is not always exactly at the position of a docking station.

## Defining service_start

You can use a `service_start` parameter, for example, to run a script instead of directly starting your vacuum cleaner. The provided service will run with the following parameters that you can use in your script to do one thing or another.
* `entity_id` - id of a vacuum
* `mode` - one of three:
  * `app_goto_target` - for _Go to target_ mode
  * `app_zoned_clean` - for _Zoned cleanup_ and _Predefined zones_ modes
  * `rooms_cleanup` - for _Rooms cleanup_ mode
* `params` - point or a list of zones (the same value as displayed in `debug` mode)
* `count` - for count the cleanings in your script. Started at 0
* `repeats` - for indicate the number of repetitions

## Defining service_return_to_base

You can use a `service_return` parameter, for example, to run a script instead of directly starting a vacuum cleaner service. You can simply use the service to return to the base of your vacuum cleaner.

## Hints

* You can find out coordinates for zones enabling `debug` in settings, drawing zone in `Zoned cleanup` mode and holding `Start` button.

## FAQ
* **Can this card show a live map?**

  Yes, to show a camera feed as a background set property `map_camera` in configuration. To get this feature without rooting your vacuum use [this](https://github.com/PiotrMachowski/Home-Assistant-custom-components-Xiaomi-Cloud-Map-Extractor) integration.

* **Does this card require rooted device?**

  No, it only utilizes features of Home Assistant and not communicates directly with a vacuum.

* **How to create a map?**

  You can use any image you want, the easiest way is to use a screenshot from Mi Home/FloleVac or [this](https://github.com/PiotrMachowski/Home-Assistant-custom-components-Xiaomi-Cloud-Map-Extractor) integration to provide live map without rooting.
