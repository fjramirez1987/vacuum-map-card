import CoordinatesConverter from './coordinates-converter.js';
import style from './style.js';
import {
    mode,
    goToTarget,
    zonedCleanup,
    zones,
    rooms,
    run,
    repeats,
    confirmation,
    texts
} from './texts.js'

const LitElement = Object.getPrototypeOf(
    customElements.get("ha-panel-lovelace")
);
const html = LitElement.prototype.html;

if (typeof loadCardHelpers !== "undefined") {
    loadCardHelpers().then(helpers => {
        if (typeof helpers.importMoreInfoControl !== "undefined") {
            helpers.importMoreInfoControl("light");
        }
    });
}

class VacuumMapCard extends LitElement {
    constructor() {
        super();
        this.isMouseDown = false;
        this.rectangles = [];
        this.selectedRectangle = -1;
        this.selectedZones = [];
        this.selectedRooms = [];
        this.currRectangle = {x: null, y: null, w: null, h: null};
        this.imageScale = -1;
        this.mode = 0;
        this.vacuumZonedCleanupRepeats = 1;
        this.currPoint = {x: null, y: null};
        this.outdatedConfig = false;
        this.missingCameraAttribute = false;
    }

    static get properties() {
        return {
            _hass: {},
            _config: {},
            isMouseDown: {},
            rectangles: {},
            selectedRectangle: {},
            selectedZones: {},
            currRectangle: {},
            mode: {},
            vacuumZonedCleanupRepeats: {},
            currPoint: {},
            mapDrawing: {},
        };
    }

    set hass(hass) {
        this._hass = hass;
        if (this._config && !this.map_image) {
            this.updateCameraImage();
        }
    }

    setConfig(config) {
        const availableModes = new Map();
        this._language = config.language || "en";
        availableModes.set("go_to_target", texts[this._language][goToTarget]);
        availableModes.set("zoned_cleanup", texts[this._language][zonedCleanup]);
        availableModes.set("predefined_zones", texts[this._language][zones]);
        availableModes.set("rooms_cleanup", texts[this._language][rooms]);

        if (!config.entity) {
            throw new Error("Missing configuration: entity");
        }
 
        if (!config.map_image && !config.map_camera) {
            throw new Error("Missing configuration: map_image or map_camera");
        }
        if (config.map_image && config.map_camera) {
            throw new Error("Only one of following properties is allowed: map_image or map_camera");
        }
        if (config.base_position || config.reference_point) {
            this.outdatedConfig = true;
            this._config = config;
            return;
        }
        if (!config.camera_calibration) {
            if (!config.calibration_points || !Array.isArray(config.calibration_points)) {
                throw new Error("Missing configuration: calibration_points or camera_calibration");
            }
            if (config.calibration_points.length !== 3) {
                throw new Error("Exactly 3 calibration_points required");
            }
            for (const calibration_point of config.calibration_points) {
                if (calibration_point.map === null) {
                    throw new Error("Missing configuration: calibration_points.map");
                }
                if (calibration_point.map.x === null) {
                    throw new Error("Missing configuration: calibration_points.map.x");
                }
                if (calibration_point.map.y === null) {
                    throw new Error("Missing configuration: calibration_points.map.y");
                }
                if (calibration_point.vacuum === null) {
                    throw new Error("Missing configuration: calibration_points.vacuum");
                }
                if (calibration_point.vacuum.x === null) {
                    throw new Error("Missing configuration: calibration_points.vacuum.x");
                }
                if (calibration_point.vacuum.y === null) {
                    throw new Error("Missing configuration: calibration_points.vacuum.y");
                }
            }
            this.updateCoordinates(config)
        } else {
            if (!config.map_camera) {
                throw new Error("Invalid configuration: map_camera is required for camera_calibration");
            }
        }

        if (config.modes) {
            if (!Array.isArray(config.modes) || config.modes.length < 1 || config.modes.length > 4) {
                throw new Error("Invalid configuration: modes");
            }
            this.modes = [];
            for (const mode of config.modes) {
                if (!availableModes.has(mode)) {
                    throw new Error("Invalid mode: " + mode);
                }
                this.modes.push(availableModes.get(mode));
            }
        } else {
            this.modes = [
                texts[this._language][goToTarget],
                texts[this._language][zonedCleanup],
                texts[this._language][zones],
                texts[this._language][rooms]
            ];
        }
        if (!config.zones || !Array.isArray(config.zones) || config.zones.length === 0 && this.modes.includes(texts[this._language][zones])) {
            this.modes.splice(this.modes.indexOf(texts[this._language][zones]), 1);
        }
        if (config.default_mode) {
            if (!availableModes.has(config.default_mode) || !this.modes.includes(availableModes.get(config.default_mode))) {
                throw new Error("Invalid default mode: " + config.default_mode);
            }
            this.mode = this.modes.indexOf(availableModes.get(config.default_mode)) + 1 ;
        }

        if (config.service_start && config.service_start.split(".").length === 2) {
            this.service_start_domain = config.service_start.split(".")[0];
            this.service_start_method = config.service_start.split(".")[1];
        } else {
            this.service_start_domain = "script";
            this.service_start_method = "vacuum_send_command";
        }

        // Configuración de servicio volver a la base:
        if (config.service_return && config.service_return.split(".").length === 2) {
            this.service_return_domain = config.service_return.split(".")[0];
            this.service_return_method = config.service_return.split(".")[1];
        } else {
            this.service_return_domain = "script";
            this.service_return_method = "vacuum_return_to_base";
        }

        if (config.map_image) {
            this.map_image = config.map_image;
        }
        this._map_refresh_interval = (config.camera_refresh_interval || 5) * 1000;
        this._config = config;
    }

    updateCoordinates(config) {
        const p1 = this.getCalibrationPoint(config, 0);
        const p2 = this.getCalibrationPoint(config, 1);
        const p3 = this.getCalibrationPoint(config, 2);
        this.coordinatesConverter = new CoordinatesConverter(p1, p2, p3);
    }

    getConfigurationMigration(config) {
        const diffX = config.reference_point.x - config.base_position.x;
        const diffY = config.reference_point.y - config.base_position.y;
        const shouldSwapAxis = diffX * diffY > 0;
        let unit = shouldSwapAxis ? diffX : diffY;
        if (shouldSwapAxis) {
            const temp = config.base_position.x;
            config.base_position.x = config.base_position.y;
            config.base_position.y = temp;
        }
        const canvasX = config.base_position.x;
        const canvasY = unit + config.base_position.y;
        let x = Math.round(canvasX);
        let y = Math.round(canvasY);
        if (shouldSwapAxis) {
            x = Math.round(canvasY);
            y = Math.round(canvasX);
        }
        return html`
<ha-card id="xiaomiCard" style="padding: 16px">
<div class="card-header" style="padding: 8px 0 16px 0;"><div class="name">Xiaomi Vacuum Map card</div></div>
<h3>Your configuration is outdated</h3>
<p>Migrate it using following calibration settings:</p>
<pre><textarea style="width: 100%; height: 22em">calibration_points:
  - vacuum:
      x: 25500
      y: 25500
    map:
      x: ${config.base_position.x}
      y: ${config.base_position.y}
  - vacuum:
      x: 26500
      y: 26500
    map:
      x: ${config.reference_point.x}
      y: ${config.reference_point.y}
  - vacuum:
      x: 25500
      y: 26500
    map:
      x: ${x}
      y: ${y}</textarea></pre>
</ha-card>`
    }

    getCalibrationPoint(config, index) {
        return {
            a: {
                x: config.calibration_points[index].map.x,
                y: config.calibration_points[index].map.y
            },
            b: {
                x: config.calibration_points[index].vacuum.x,
                y: config.calibration_points[index].vacuum.y
            }
        };
    }

    render() {
        if (this.outdatedConfig) {
            return this.getConfigurationMigration(this._config);
        }
        const modesDropdown = this.modes.map(m => html`<paper-item>${m}</paper-item>`);
        const rendered = html`
        ${style}
        <ha-card id="xiaomiCard">
            <div id="mapWrapper">
                <div id="map">

                <div id="buttonMode_1" class="buttonBackground buttonMode ${this.isSelected(1)}" style="top:10px;" @click="${() => this.modeSelectButton(1)}"><ha-icon class="buttonIcon buttonIconMode" icon="mdi:map-marker-outline"></ha-icon></div>
                <div id="buttonMode_2" class="buttonBackground buttonMode ${this.isSelected(2)}" style="top:70px;" @click="${() => this.modeSelectButton(2)}"><ha-icon class="buttonIcon buttonIconMode" icon="mdi:shape-square-plus"></ha-icon></div>
                <div id="buttonMode_3" class="buttonBackground buttonMode ${this.isSelected(3)}" style="top:130px;" @click="${() => this.modeSelectButton(3)}"><ha-icon class="buttonIcon buttonIconMode" icon="mdi:vector-selection"></ha-icon></div>
                <div id="buttonMode_4" class="buttonBackground buttonMode ${this.isSelected(4)}" style="top:190px;" @click="${() => this.modeSelectButton(4)}"><ha-icon class="buttonIcon buttonIconMode" icon="mdi:view-dashboard"></ha-icon></div>
                <div class="buttonBackground buttonMode" style="top:280px;" @click="${() => this.vacuumZonedIncreaseButton()}"><ha-icon class="buttonIcon buttonIconReplay" icon="mdi:replay"></ha-icon><span class="txtCountReplay">${this.vacuumZonedCleanupRepeats}</span></div>
                <div class="buttonBackground buttonStart" @click="${() => this.vacuumStartButton(true)}"><ha-icon class="buttonIcon buttonIconStart" icon="mdi:power"></ha-icon></div>
                <div class="buttonBackground buttonReturnToBase" @click="${() => this.vacuumReturnToBase()}"><ha-icon class="buttonIcon buttonIconStart" icon="mdi:flash"></ha-icon></div>
                
                    <img id="mapBackground" @load="${() => this.calculateScale()}" src="${this.map_image}">
                    <canvas id="mapDrawing" style="${this.getCanvasStyle()}"
                        @mousemove="${e => this.onMouseMove(e)}"
                        @mousedown="${e => this.onMouseDown(e)}"
                        @mouseup="${e => this.onMouseUp(e)}"
                        @touchstart="${e => this.onTouchStart(e)}"
                        @touchend="${e => this.onTouchEnd(e)}"
                        @touchmove="${e => this.onTouchMove(e)}">
                    </canvas>

                      
                </div>
            </div>
            ${this.missingCameraAttribute ? 
            html`<div style="padding: 5px;">
            <h3>Your camera entity is not providing calibration_points</h3>
            <p>Enable calibration_points in camera entity or disable camera_calibration</p>
            </div>` : 
            html`
            <div id="toast"><div id="img"><ha-icon icon="mdi:check" style="vertical-align: center"></ha-icon></div><div id="desc">${texts[this._language][confirmation]}</div></div>`} 
        </ha-card>`;

            if (this.getMapImage()) {
                this.calculateScale();
            }

        return rendered;
    }

    calculateScale() {
        const img = this.getMapImage();
        const canvas = this.getCanvas();
        this.imageScale = img.width / img.naturalWidth;
        const mapHeight = Math.round(this.imageScale * img.naturalHeight);
        img.parentElement.parentElement.style.height = mapHeight + "px";
        canvas.width = img.width;
        canvas.height = mapHeight;
        this.drawCanvas();
    }

    onMouseDown(e) {
        const pos = this.getMousePos(e);
        this.isMouseDown = true;
        if (this.mode === 1) {
            this.currPoint.x = pos.x;
            this.currPoint.y = pos.y;
        } else if (this.mode === 2) {
            const {selected, shouldDelete, shouldResize} = this.getSelectedRectangle(pos.x, pos.y);
            this.currRectangle.x = pos.x;
            this.currRectangle.y = pos.y;
            if (shouldDelete) {
                this.rectangles.splice(selected, 1);
                this.selectedRectangle = -1;
                this.isMouseDown = false;
                this.drawCanvas();
                return;
            }
            if (shouldResize) {
                this.currRectangle.x = this.rectangles[selected].x;
                this.currRectangle.y = this.rectangles[selected].y;
                this.rectangles.splice(selected, 1);
                this.drawCanvas();
                return;
            }
            this.selectedRectangle = selected;
            if (this.selectedRectangle >= 0) {
                this.currRectangle.w = this.rectangles[this.selectedRectangle].x;
                this.currRectangle.h = this.rectangles[this.selectedRectangle].y;
            } else {
                this.currRectangle.w = 0;
                this.currRectangle.h = 0;
            }
        } else if (this.mode === 3) {
            const selectedZone = this.getSelectedZone(pos.x, pos.y);
            if (selectedZone >= 0) {
                if (this.selectedZones.includes(selectedZone)) {
                    this.selectedZones.splice(this.selectedZones.indexOf(selectedZone), 1);
                } else {
                    if (this.selectedZones.length < 5 || this._config.ignore_zones_limit) {
                        this.selectedZones.push(selectedZone);
                    }
                }
            }
        } else if (this.mode === 4) {
            const selectedZone = this.getSelectedRoom(pos.x, pos.y);
            if (selectedZone >= 0) {
                if (this.selectedRooms.includes(selectedZone)) {
                    this.selectedRooms.splice(this.selectedRooms.indexOf(selectedZone), 1);
                } else {
                    this.selectedRooms.push(selectedZone);
                }
            }
        }
        this.drawCanvas();
    }

    onMouseUp(e) {
        this.isMouseDown = false;
        if (this.selectedRectangle >= 0 || this.mode !== 2 || this.mode === 2 && this.rectangles.length >= 5 && !this._config.ignore_zones_limit) {
            this.selectedRectangle = -1;
            this.drawCanvas();
            return;
        }
        const {x, y} = this.getMousePos(e);
        const rx = Math.min(x, this.currRectangle.x);
        const ry = Math.min(y, this.currRectangle.y);
        const rw = Math.max(x, this.currRectangle.x) - rx;
        const rh = Math.max(y, this.currRectangle.y) - ry;
        this.currRectangle.x = rx;
        this.currRectangle.y = ry;
        this.currRectangle.w = rw;
        this.currRectangle.h = rh;
        if (rw > 5 && rh > 5) {
            this.rectangles.push({x: rx, y: ry, w: rw, h: rh});
        }
        this.drawCanvas();
    }

    onMouseMove(e) {
        if (this.isMouseDown && this.mode === 2) {
            const {x, y} = this.getMousePos(e);
            if (this.selectedRectangle < 0) {
                this.currRectangle.w = x - this.currRectangle.x;
                this.currRectangle.h = y - this.currRectangle.y;
            } else {
                this.rectangles[this.selectedRectangle].x = this.currRectangle.w + x - this.currRectangle.x;
                this.rectangles[this.selectedRectangle].y = this.currRectangle.h + y - this.currRectangle.y;
            }
            this.drawCanvas();
        }
    }

    onTouchStart(e) {
        if (this.mode === 2) {
            this.onMouseDown(this.convertTouchToMouse(e));
        }
    }

    onTouchEnd(e) {
        if (this.mode === 2) {
            this.onMouseUp(this.convertTouchToMouse(e));
        }
    }

    onTouchMove(e) {
        if (this.mode === 2) {
            this.onMouseMove(this.convertTouchToMouse(e));
        }
    }

    isSelected(buttonMode){
        if (buttonMode === this.mode) {
            return 'disable';
        }
    }

    // Al pulsar el botón de un modo:
    modeSelectButton(mode) {
        this.mode = mode;
        /*
        var elemento = this.shadowRoot.querySelectorAll(".disable");
            for (var i = 0; i < elemento.length; i++) {
                  elemento[i].classList.remove("disable");
            }       

        const x = this.shadowRoot.getElementById("buttonMode_"+mode);
        x.className += " disable";
        */
        this.drawCanvas();
    }

    vacuumZonedIncreaseButton() {
        this.vacuumZonedCleanupRepeats++;
        if (this.vacuumZonedCleanupRepeats > 3) {
            this.vacuumZonedCleanupRepeats = 1;
        }
    }

    // Al presionar el botón Start:
    vacuumStartButton(debug) {
        if (this.mode === 1 && this.currPoint.x != null) {
            this.vacuumGoToPoint(debug);
        } else if (this.mode === 2 && !this.rectangles.empty) {
            this.vacuumStartZonedCleanup(debug);
        } else if (this.mode === 3 && !this.selectedZones.empty) {
            this.vacuumStartPreselectedZonesCleanup(debug);
        } else if (this.mode === 4 && !this.selectedRooms.empty) {
            this.vacuumStartRoomsCleanup(debug);
        }
    }

    // Al presionar el botón volver a la base:
    vacuumReturnToBase() {
        this._hass.callService(this.service_return_domain, this.service_return_method).then(() => this.showToast());
    }

    // Dibujar figuras en el mapa:
    drawCanvas() {
        const canvas = this.getCanvas();
        const context = canvas.getContext("2d");
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.translate(0.5, 0.5);
        if (this._config.debug) {
            let calibration_points = this._config.calibration_points;
            if (this._config.camera_calibration) {
                calibration_points = this._hass.states[this._config.map_camera].attributes.calibration_points;
            }
            for (const calibration_point of calibration_points) {
                const {x, y} = this.convertVacuumToMapCoordinates(calibration_point.vacuum.x, calibration_point.vacuum.y);
                this.drawCircle(context, x, y, 4, 'red', 1);
            }
        }
        if (this.mode === 1 && this.currPoint.x != null) {
            this.drawCircle(context, this.currPoint.x, this.currPoint.y, 4, 'yellow', 1);
        } else if (this.mode === 2) {
            for (let i = 0; i < this.rectangles.length; i++) {
                const rect = this.rectangles[i];
                context.beginPath();
                if (i === this.selectedRectangle) {
                    context.setLineDash([10, 5]);
                    context.strokeStyle = 'white';
                } else {
                    context.setLineDash([]);
                    context.strokeStyle = 'white';
                    context.fillStyle = 'rgba(255, 255, 255, 0.25)';
                    context.fillRect(rect.x, rect.y, rect.w, rect.h);
                }
                context.rect(rect.x, rect.y, rect.w, rect.h);
                context.lineWidth = 1;
                context.stroke();
                this.drawDelete(context, rect.x + rect.w, rect.y);
                this.drawResize(context, rect.x + rect.w, rect.y + rect.h);
            }
            if (this.isMouseDown && this.selectedRectangle < 0) {
                context.beginPath();
                context.setLineDash([10, 5]);
                context.strokeStyle = 'white';
                context.lineWidth = 1;
                context.rect(this.currRectangle.x, this.currRectangle.y, this.currRectangle.w, this.currRectangle.h);
                context.stroke();
            }
        } else if (this.mode === 3) {
            for (let i = 0; i < this._config.zones.length; i++) {
                const zone = this._config.zones[i];
                for (const rect of zone) {
                    const {x, y, w, h} = this.convertVacuumToMapZone(rect[0], rect[1], rect[2], rect[3]);
                    context.beginPath();
                    context.setLineDash([]);
                    if (!this.selectedZones.includes(i)) {
                        context.strokeStyle = 'red';
                        context.fillStyle = 'rgba(255, 0, 0, 0.25)';
                    } else {
                        context.strokeStyle = 'green';
                        context.fillStyle = 'rgba(0, 255, 0, 0.25)';
                    }
                    context.lineWidth = 1;
                    context.rect(x, y, w, h);
                    context.fillRect(x, y, w, h);
                    context.stroke();
                }
            }
        } else if (this.mode === 4){
            for (let i = 0; i < this._config.rooms.length; i++) {
                const zone = this._config.rooms[i];
                for (const rect of zone) {
                    const {x, y, w, h} = this.convertVacuumToMapZone(rect[0], rect[1], rect[2], rect[3]);
                    context.beginPath();
                    context.setLineDash([]);
                    if (!this.selectedRooms.includes(i)) {
                        context.strokeStyle = 'red';
                        context.fillStyle = 'rgba(255, 0, 0, 0)';
                    } else {
                        context.strokeStyle = 'green';
                        context.lineWidth = 1;
                        context.fillStyle = 'rgba(0, 255, 0, 0.25)';
                        context.rect(x, y, w, h);
                    }
                    
                    context.fillRect(x, y, w, h);
                    context.stroke();
                }
            }
        }
        context.translate(-0.5, -0.5);
    }

    drawCircle(context, x, y, r, style, lineWidth) {
        context.beginPath();
        context.arc(x, y, r, 0, Math.PI * 2);
        context.strokeStyle = style;
        context.lineWidth = lineWidth;
        context.stroke();
    }

    drawDelete(context, x, y) {
        context.setLineDash([]);
        this.drawCircle(context, x, y, 8, 'black', 1.2);
        const diff = 4;
        context.moveTo(x - diff, y - diff);
        context.lineTo(x + diff, y + diff);
        context.moveTo(x - diff, y + diff);
        context.lineTo(x + diff, y - diff);
        context.stroke();
    }

    drawResize(context, x, y) {
        context.setLineDash([]);
        this.drawCircle(context, x, y, 8, 'black', 1.2);
        const diff = 4;
        context.moveTo(x - diff, y - diff);
        context.lineTo(x + diff, y + diff);
        context.lineTo(x + diff, y + diff - 4);
        context.lineTo(x + diff - 4, y + diff);
        context.lineTo(x + diff, y + diff);
        context.moveTo(x - diff, y - diff);
        context.lineTo(x - diff, y - diff + 4);
        context.lineTo(x - diff + 4, y - diff);
        context.lineTo(x - diff, y - diff);
        context.stroke();
    }

    getSelectedRectangle(x, y) {
        let selected = -1;
        let shouldDelete = false;
        let shouldResize = false;
        for (let i = this.rectangles.length - 1; i >= 0; i--) {
            const rect = this.rectangles[i];
            if (Math.pow(x - rect.x - rect.w, 2) + Math.pow(y - rect.y, 2) <= 64) {
                selected = i;
                shouldDelete = true;
                break;
            }
            if (Math.pow(x - rect.x - rect.w, 2) + Math.pow(y - rect.y - rect.h, 2) <= 64) {
                selected = i;
                shouldResize = true;
                break;
            }
            if (x >= rect.x && y >= rect.y && x <= rect.x + rect.w && y <= rect.y + rect.h) {
                selected = i;
                break;
            }
        }
        return {selected, shouldDelete, shouldResize};
    }

    // Obtiene la zona seleccionada a partir de un punto:
    getSelectedZone(mx, my) {
        let selected = -1;
        for (let i = 0; i < this._config.zones.length && selected === -1; i++) {
            const zone = this._config.zones[i];
            for (const rect of zone) {
                const {x, y, w, h} = this.convertVacuumToMapZone(rect[0], rect[1], rect[2], rect[3]);
                if (mx >= x && my >= y && mx <= x + w && my <= y + h) {
                    selected = i;
                    break;
                }
            }
        }
        return selected;
    }
    
    // Obtiene la habitación seleccionada a partir de un punto:
    getSelectedRoom(mx, my) {
        let selected = -1;
        for (let i = 0; i < this._config.rooms.length && selected === -1; i++) {
            const zone = this._config.rooms[i];
            for (const rect of zone) {
                const {x, y, w, h} = this.convertVacuumToMapZone(rect[0], rect[1], rect[2], rect[3]);
                if (mx >= x && my >= y && mx <= x + w && my <= y + h) {
                    selected = i;
                    break;
                }
            }
        }
        return selected;
    }

    getCanvasStyle() {
        if (this.mode === 2) return html`touch-action: none;`;
        else return html``;
    }

    // Limpiar un punto:
    vacuumGoToPoint(debug) {
        const mapPos = this.convertMapToVacuumCoordinates(this.currPoint.x, this.currPoint.y);
        if (debug && this._config.debug) {
            alert(
                'entity_id: ' +  this._config.entity +
                '\nmode: app_goto_target' +
                '\nparams: ' + JSON.stringify([mapPos.x, mapPos.y]) +
                '\ncount: 0' +
                '\nrepeats: ' + this.vacuumZonedCleanupRepeats
                );
        } else {
            this._hass.callService(this.service_start_domain, this.service_start_method, {
                entity_id: this._config.entity,
                mode: "app_goto_target",
                params: [mapPos.x, mapPos.y],
                count: 0,
                repeats: this.vacuumZonedCleanupRepeats
            }).then(() => this.showToast());
        }
    }

    // Limpiar por zonas:
    vacuumStartZonedCleanup(debug) {
        const zone = [];
        for (const rect of this.rectangles) {
            zone.push(this.convertMapToVacuumRect(rect));
        }
        if (debug && this._config.debug) {
            alert(
                'entity_id: ' +  this._config.entity +
                '\nmode: app_zoned_clean' +
                '\nparams: ' + JSON.stringify(zone) +
                '\ncount: 0' +
                '\nrepeats: ' + this.vacuumZonedCleanupRepeats
                );
        } else {
            this._hass.callService(this.service_start_domain, this.service_start_method, {
                entity_id: this._config.entity,
                mode: "app_zoned_clean",
                params: zone,
                count: 0,
                repeats: this.vacuumZonedCleanupRepeats
            }).then(() => this.showToast());
        }
    }

    // Limpiar zonas preseleccionadas:
    vacuumStartPreselectedZonesCleanup(debug) {
        const zone = [];
        for (let i = 0; i < this.selectedZones.length; i++) {
            const selectedZone = this.selectedZones[i];
            const preselectedZone = this._config.zones[selectedZone];
            for (const rect of preselectedZone) {
                zone.push([rect[0], rect[1], rect[2], rect[3]])
            }
        }
        if (debug && this._config.debug) {
            alert(
                'entity_id: ' +  this._config.entity +
                '\nmode: app_zoned_clean' +
                '\nparams: ' + JSON.stringify(zone) +
                '\ncount: 0' +
                '\nrepeats: ' + this.vacuumZonedCleanupRepeats
                );
        } else {
            this._hass.callService(this.service_start_domain, this.service_start_method, {
                entity_id: this._config.entity,
                mode: "app_zoned_clean",
                params: zone,
                count: 0,
                repeats: this.vacuumZonedCleanupRepeats
            }).then(() => this.showToast());
        }
    }
    
    // Limpiar habitaciones:
    vacuumStartRoomsCleanup(debug) {
        const roomsId = [];
        for (let i = 0; i < this.selectedRooms.length; i++) {
            const selectedRoom = this.selectedRooms[i];
            const preselectedRoom = this._config.rooms[selectedRoom];
            for (const rect of preselectedRoom) {
                roomsId.push(rect[4]);
            }
        }
        if (debug && this._config.debug) {
            if (roomsId.length > 0){
                alert(
                    'entity_id: ' +  this._config.entity +
                    '\nmode: rooms_cleanup' +
                    '\nparams: ' + JSON.stringify(roomsId) +
                    '\ncount: 0' +
                    '\nrepeats: ' + this.vacuumZonedCleanupRepeats
                    );
            } else {
                alert(
                    'entity_id: ' +  this._config.entity +
                    '\nmode: all_rooms_cleanup' +
                    '\nparams: ' + JSON.stringify(roomsId) +
                    '\ncount: 0' +
                    '\nrepeats: ' + this.vacuumZonedCleanupRepeats
                    );
            }
        } else {
            if (roomsId.length > 0){
                this._hass.callService(this.service_start_domain, this.service_start_method, {
                    entity_id: this._config.entity,
                    mode: "rooms_cleanup",
                    params: roomsId,
                    count: 0,
                    repeats: this.vacuumZonedCleanupRepeats
                }).then(() => this.showToast());
            } else {
                this._hass.callService(this.service_start_domain, this.service_start_method, {
                    entity_id: this._config.entity,
                    mode: "all_rooms_cleanup",
                    params: roomsId,
                    count: 0,
                    repeats: this.vacuumZonedCleanupRepeats
                }).then(() => this.showToast());
            }

        }
    }

    getCardSize() {
        return 5;
    }

    // Redondea un numero decimal:
    round(num, decimales = 1) {
        var signo = (num >= 0 ? 1 : -1);
        num = num * signo;
        if (decimales === 0) //con 0 decimales
            return signo * Math.round(num);
        // round(x * 10 ^ decimales)
        num = num.toString().split('e');
        num = Math.round(+(num[0] + 'e' + (num[1] ? (+num[1] + decimales) : decimales)));
        // x * 10 ^ (-decimales)
        num = num.toString().split('e');
        return signo * (num[0] + 'e' + (num[1] ? (+num[1] - decimales) : -decimales));
    }

    convertMapToVacuumRect(rect) {
        const xy1 = this.convertMapToVacuumCoordinates(rect.x, rect.y);
        const xy2 = this.convertMapToVacuumCoordinates(rect.x + rect.w, rect.y + rect.h);
        const x1 = Math.min(xy1.x, xy2.x);
        const y1 = Math.min(xy1.y, xy2.y);
        const x2 = Math.max(xy1.x, xy2.x);
        const y2 = Math.max(xy1.y, xy2.y);
        return [x1, y1, x2, y2];
    }

    convertMapToVacuumCoordinates(mapX, mapY) {
        const {x, y} = this.coordinatesConverter.convertAB(mapX / this.imageScale, mapY / this.imageScale);
        return {x: this.round(x), y: this.round(y)};
    }

    convertVacuumToMapZone(vacuumX1, vacuumY1, vacuumX2, vacuumY2) {
        const {x: x1, y: y1} = this.convertVacuumToMapCoordinates(vacuumX1, vacuumY1);
        const {x: x2, y: y2} = this.convertVacuumToMapCoordinates(vacuumX2, vacuumY2);
        let x = Math.min(x1, x2);
        let y = Math.min(y1, y2);
        let w = Math.abs(x2 - x1);
        let h = Math.abs(y2 - y1);
        return {x, y, w, h};
    }

    convertVacuumToMapCoordinates(vacuumX, vacuumY) {
        const {x: vX, y: vY} = this.coordinatesConverter.convertBA(vacuumX, vacuumY);
        const x = Math.round(vX * this.imageScale);
        const y = Math.round(vY * this.imageScale);
        return {x, y};
    }

    getMapImage() {
        return this.shadowRoot.getElementById("mapBackground");
    }

    getCanvas() {
        return this.shadowRoot.getElementById("mapDrawing");
    }

    getMousePos(evt) {
        const canvas = this.getCanvas();
        const rect = canvas.getBoundingClientRect();
        return {
            x: Math.round(evt.clientX - rect.left),
            y: Math.round(evt.clientY - rect.top)
        };
    }

    convertTouchToMouse(evt) {
        if (evt.cancelable && this.mode === 2) {
            evt.preventDefault();
        }
        return {
            clientX: evt.changedTouches[0].clientX,
            clientY: evt.changedTouches[0].clientY,
            currentTarget: evt.currentTarget
        };
    }

    showToast() {
        const x = this.shadowRoot.getElementById("toast");
        x.className = "show";
        setTimeout(function () {
            x.className = x.className.replace("show", "");
        }, 2000);
    }

    updateCameraImage() {
        this._hass.callWS({
            type: 'camera_thumbnail',
            entity_id: this._config.map_camera,
        }).then(val => {
            const {content_type: contentType, content} = val;
            this.map_image = `data:${contentType};base64, ${content}`;
            if (this._config.camera_calibration) {
                if (!this._hass.states[this._config.map_camera].attributes.calibration_points) {
                    this.missingCameraAttribute = true;
                } else {
                    this.updateCoordinates(this._hass.states[this._config.map_camera].attributes)
                }
            }
            this.requestUpdate();
        })
    }

    connectedCallback() {
        super.connectedCallback();
        if (this._config.map_camera) {
            this.thumbUpdater = setInterval(() => this.updateCameraImage(), this._map_refresh_interval);
        }
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        if (this._config.map_camera) {
            clearInterval(this.thumbUpdater);
            this.map_image = null;
        }
    }
}

customElements.define('vacuum-map-card', VacuumMapCard);
