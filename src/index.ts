import {
    Plugin,
    Protyle,
    fetchPost,
} from "siyuan";
import "./index.scss";

export default class CircuitPlugin extends Plugin {
    private observer: MutationObserver;
    private lastSavedState = new Map<string, string>();
    private pollingIntervals = new Map<string, any>();
    private saveTimeouts = new Map<string, any>();
    private isDirty = new Map<string, boolean>();
    private boundHandleMessage: (event: MessageEvent) => void;

    onload() {
        console.log("CircuitJS Simulator Plugin loaded");

        this.protyleSlash = [{
            filter: ["circuit", "电路", "dl"],
            html: `<div class="b3-list-item__first"><span class="b3-list-item__text">${this.i18n.insertCircuit}</span><span class="b3-list-item__meta">CircuitJS</span></div>`,
            id: "insertCircuit",
            callback: (protyle: Protyle) => {
                this.insertCircuit(protyle);
            }
        }];

        // Intercept Escape key globally in capture phase to prevent SiYuan from exiting 
        // edit mode when focus is inside our UI, and route it to CircuitJS "Select" mode.
        window.addEventListener("keydown", (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                const target = event.target as HTMLElement;
                const container = target.closest(".circuit-container");
                if (container) {
                    event.stopPropagation();
                    const id = container.getAttribute("data-id");
                    if (id) {
                        const iframe = document.getElementById(`iframe-${id}`) as HTMLIFrameElement;
                        const win = iframe?.contentWindow as any;
                        if (win && win.circuitjs_setMenuSelection) {
                            win.circuitjs_setMenuSelection("Select");
                        }
                    }
                }
            }
        }, true);

        this.boundHandleMessage = this.handleMessage.bind(this);
        window.addEventListener('message', this.boundHandleMessage);

        // Use standard SiYuan events for re-hydration
        this.eventBus.on("loaded-protyle-static", () => this.rebindAll());
        this.eventBus.on("loaded-protyle-dynamic", () => this.rebindAll());
        
        // Also use MutationObserver for immediate feedback when inserting or switching
        this.observer = new MutationObserver(() => this.rebindAll());
        this.observer.observe(document.body, { childList: true, subtree: true });

        // Initial run
        setTimeout(() => this.rebindAll(), 1000);
    }

    private insertCircuit(protyle: Protyle) {
        // Use a simple iframe without custom classes that SiYuan might strip.
        // We do NOT add &cct= here, so CircuitJS loads the default example circuit asynchronously.
        const simulatorUrl = `/plugins/siyuan-circuitjs/circuitjs1/circuitjs.html?hideMenu=true&hideSidebar=true`;
        const html = `<iframe src="${simulatorUrl}" style="width: 100%; height: 640px;" data-subtype="iframe" border="0" frameborder="0" allowfullscreen="true"></iframe>`;
        protyle.insert(html, true);
    }

    private rebindAllTimeout: any;
    private rebindAll() {
        if (this.rebindAllTimeout) clearTimeout(this.rebindAllTimeout);
        this.rebindAllTimeout = setTimeout(() => {
            const iframes = document.querySelectorAll('iframe');
            iframes.forEach((iframe: HTMLIFrameElement) => {
                // Check if this is one of our circuit iframes by src
                if (iframe.src && iframe.src.includes('circuitjs.html')) {
                    const blockElement = this.findBlockElement(iframe);
                    if (blockElement) {
                        const blockId = blockElement.getAttribute('data-node-id');
                        if (blockId && !iframe.getAttribute('data-bound')) {
                            this.ensureUIWrapper(iframe, blockId);
                            this.bindIframe(iframe, blockId);
                        }
                    }
                }
            });
        }, 200);
    }

    private ensureUIWrapper(iframe: HTMLIFrameElement, blockId: string) {
        // If it's already wrapped, don't do it again
        if (iframe.parentElement?.classList.contains('circuit-iframe-wrapper')) return;

        console.log("CircuitJS: Injecting UI wrapper for block", blockId);
        
        // Create the structure
        const container = document.createElement('div');
        container.className = 'circuit-container';
        container.setAttribute('data-id', blockId);
        container.setAttribute('contenteditable', 'false');
        container.style.height = '100%';
        container.style.width = '100%';

        container.innerHTML = `
            <div class="circuit-toolbar">
                <button data-action="run-pause" data-target-id="${blockId}">Play/Pause</button>
                <button data-action="reset" data-target-id="${blockId}">Reset</button>
                <button data-action="undo" data-target-id="${blockId}">Undo</button>
                <button data-action="redo" data-target-id="${blockId}">Redo</button>
                <div class="toolbar-spacer"></div>
                <select data-action="add-component" data-target-id="${blockId}">
                    <option value="">Add Component...</option>
                    <option value="Select     ">Select/Drag</option>
                    <option value="DragAll    ">Drag All</option>
                    <option value="DragRow    ">Drag Row</option>
                    <option value="DragColumn ">Drag Column</option>
                    <option value="WireElm">Wire</option>
                    <option value="ResistorElm">Resistor</option>
                    <option value="GroundElm">Ground</option>
                    <option value="DCVoltageElm">DC Source</option>
                    <option value="ACVoltageElm">AC Source</option>
                    <option value="CapacitorElm">Capacitor</option>
                    <option value="InductorElm">Inductor</option>
                    <option value="SwitchElm">Switch</option>
                    <option value="PotElm">Potentiometer</option>
                    <option value="DiodeElm">Diode</option>
                    <option value="LEDElm">LED</option>
                    <option value="OpAmpElm">OpAmp</option>
                    <option value="TransistorElm">NPN</option>
                    <option value="PTransistorElm">PNP</option>
                    <option value="AndGateElm">And</option>
                    <option value="OrGateElm">Or</option>
                    <option value="NandGateElm">Nand</option>
                    <option value="InverterElm">Inverter</option>
                </select>
                <button data-action="toggle-sidebar" data-target-id="${blockId}">⚙️</button>
            </div>
            <div class="circuit-main-area">
                <div class="circuit-iframe-wrapper"></div>
                <div class="circuit-sidebar collapsed" id="sidebar-${blockId}">
                    <h4>Simulation</h4>
                    <div class="sidebar-section">
                        <label>Sim Speed: <span id="val-speed-${blockId}">187</span></label>
                        <input type="range" min="0" max="260" value="187" data-action="speed-slider" data-target-id="${blockId}">
                    </div>
                    <div class="sidebar-section">
                        <label>Current Speed: <span id="val-current-${blockId}">68</span></label>
                        <input type="range" min="1" max="100" value="68" data-action="current-slider" data-target-id="${blockId}">
                    </div>
                    <h4>Persistence</h4>
                    <div class="sidebar-section">
                        <textarea id="code-${blockId}" placeholder="Circuit code..."></textarea>
                        <div class="button-group">
                            <button data-action="export-code" data-target-id="${blockId}">Export</button>
                            <button data-action="import-code" data-target-id="${blockId}">Import</button>
                            <button data-action="save-to-siyuan" data-target-id="${blockId}">Save Block</button>
                        </div>
                    </div>
                </div>
            </div>`;

        // Prevent SiYuan block selection by stopping propagation in the bubble phase.
        // This ensures the events reach our elements natively (so dropdowns work) but SiYuan never sees them.
        const stop = (e: Event) => e.stopPropagation();
        container.addEventListener('mousedown', stop);
        container.addEventListener('mouseup', stop);
        container.addEventListener('pointerdown', stop);
        
        container.addEventListener('click', (e) => {
            e.stopPropagation();
            this.handleToolbarAction(e.target as HTMLElement);
        });
        
        container.addEventListener('change', (e) => {
            e.stopPropagation();
            this.handleInputChange(e);
        });
        
        container.addEventListener('input', (e) => {
            e.stopPropagation();
            this.handleInputChange(e);
        });

        const wrapper = container.querySelector('.circuit-iframe-wrapper');
        iframe.parentNode?.insertBefore(container, iframe);
        wrapper?.appendChild(iframe);
    }

    private bindIframe(iframe: HTMLIFrameElement, blockId: string) {
        iframe.setAttribute('data-bound', 'true');
        iframe.id = `iframe-${blockId}`;
        
        // Find the container to ensure toolbar/sidebar are also associated with the correct ID
        const container = iframe.closest('.circuit-container') as HTMLElement;
        if (container) {
            container.setAttribute('data-id', blockId);
            // Update all target IDs in the toolbar/sidebar
            container.querySelectorAll('[data-target-id]').forEach(el => {
                el.setAttribute('data-target-id', blockId);
            });
            const sidebar = container.querySelector('.circuit-sidebar');
            if (sidebar) sidebar.id = `sidebar-${blockId}`;
            
            const speedVal = container.querySelector(`[id^="val-speed-"]`);
            if (speedVal) speedVal.id = `val-speed-${blockId}`;
            
            const currentVal = container.querySelector(`[id^="val-current-"]`);
            if (currentVal) currentVal.id = `val-current-${blockId}`;

            const codeArea = container.querySelector(`[id^="code-"]`);
            if (codeArea) codeArea.id = `code-${blockId}`;
        }

        // --- RUNTIME PATCH FOR SIMULATOR BUG ---
        // The simulator's menuPerformed has a bug: it calls .substring(0, 10) 
        // without checking length, causing StringIndexOutOfBoundsException for "WireElm" (7 chars).
        const win = iframe.contentWindow as any;
        if (win && win.circuitjs_menuPerformed) {
            const originalMP = win.circuitjs_menuPerformed;
            win.circuitjs_menuPerformed = function(menu: string, item: string) {
                // If item is too short, pad it for the check, or just bypass the buggy check
                if (item && item.length < 10) {
                    console.log("CircuitJS Patch: Bypassing buggy substring check for", item);
                    // The buggy check in CirSim.java is: if (item.substring(0,10)=="addToScope" ...)
                    // Since our item is < 10, it definitely isn't "addToScope".
                    // We can't easily fix the GWT-compiled code, but we can wrap the call.
                    try {
                        return originalMP.call(win, menu, item);
                    } catch (e) {
                        // If it still fails, it's likely the substring call. 
                        // Most component names are handled in the 'else' block which uses .equals().
                        // We can try to simulate the effect of the 'else' block or just provide a safe string.
                    }
                }
                return originalMP.call(win, menu, item);
            };
        }

        console.log("CircuitJS: Binding block", blockId);
        this.loadCircuitFromAttr(blockId, iframe);
    }

    private loadCircuitFromAttr(id: string, iframe: HTMLIFrameElement) {
        // Clear any existing polling for this ID
        if (this.pollingIntervals.has(id)) {
            clearInterval(this.pollingIntervals.get(id));
            this.pollingIntervals.delete(id);
        }

        const checkWin = () => {
            // Check if iframe is still in DOM
            if (!document.body.contains(iframe)) return;
            
            const win = iframe.contentWindow as any;
            if (win && win.circuitjs_readCircuit && win.circuitjs_dumpCircuit) {
                fetchPost("/api/attr/getBlockAttrs", { id }, (res) => {
                    const encodedData = res?.data?.["custom-circuit"];
                    if (encodedData) {
                        // If it has saved data, but it's currently loading the example circuit (no cct=%24),
                        // we must redirect it to start blank so the async loader is disabled,
                        // otherwise the async loader will overwrite our restored data.
                        if (!iframe.src.includes('cct=%24')) {
                            console.log("CircuitJS: Reloading iframe with cct=%24 to prevent async overwrite");
                            // Append cct=%24 and wait for the NEXT circuitjs-ready event.
                            iframe.src = iframe.src + '&cct=%24';
                            return; // Stop here. The iframe will reload and fire circuitjs-ready again.
                        }

                        try {
                            const data = decodeURIComponent(encodedData);
                            console.log("CircuitJS: Restoring state for", id);
                            win.circuitjs_readCircuit(data);
                            this.lastSavedState.set(id, data);
                        } catch (e) {
                            console.error("CircuitJS: Failed to decode state", e);
                            win.circuitjs_readCircuit(encodedData);
                            this.lastSavedState.set(id, encodedData);
                        }
                    } else {
                        // Initialize lastSavedState to avoid immediate false-positive save
                        this.lastSavedState.set(id, win.circuitjs_dumpCircuit());
                    }

                    // Track user interactions to save quickly after they stop clicking/dragging
                    let interactionTimeout: any;
                    const markInteracted = () => { 
                        if (interactionTimeout) clearTimeout(interactionTimeout);
                        
                        // Store the timeout so we can clean it up in onunload
                        this.saveTimeouts.set(id, interactionTimeout);

                        interactionTimeout = setTimeout(() => {
                            this.saveTimeouts.delete(id);
                            try {
                                if (win.circuitjs_dumpCircuit) {
                                    const currentData = win.circuitjs_dumpCircuit();
                                    const lastData = this.lastSavedState.get(id);
                                    if (currentData && currentData !== lastData) {
                                        this.persistState(id, currentData, iframe);
                                    }
                                }
                            } catch (e) {
                                console.warn("CircuitJS: Auto-save failed", e);
                            }
                        }, 500); // Save 0.5 seconds after the user's last interaction
                    };

                    if (win) {
                        // Use capture phase (true) to ensure we catch these before GWT can stop propagation
                        win.addEventListener('mousedown', markInteracted, true);
                        win.addEventListener('mouseup', markInteracted, true);
                        win.addEventListener('keyup', markInteracted, true);
                        win.addEventListener('touchstart', markInteracted, true);
                        win.addEventListener('touchend', markInteracted, true);
                        win.addEventListener('wheel', markInteracted, true);
                        
                        win.addEventListener('keydown', (e: KeyboardEvent) => {
                            markInteracted();
                            if (e.key === "Escape") {
                                e.stopPropagation();
                                if (win.circuitjs_setMenuSelection) {
                                    win.circuitjs_setMenuSelection("Select");
                                }
                            }
                        }, true);
                    }

                    const container = iframe.closest('.circuit-container');
                    if (container) {
                        container.addEventListener('click', markInteracted, true);
                        container.addEventListener('change', markInteracted, true);
                        container.addEventListener('input', markInteracted, true);
                    }
                });
            } else {
                setTimeout(checkWin, 500);
            }
        };
        checkWin();
    }

    private scheduleSave(id: string, data: string, iframe: HTMLIFrameElement) {
        if (this.saveTimeouts.has(id)) clearTimeout(this.saveTimeouts.get(id));

        const timeout = setTimeout(() => {
            if (this.isDirty.get(id)) {
                this.persistState(id, data, iframe);
                this.isDirty.set(id, false);
            }
            this.saveTimeouts.delete(id);
        }, 100); // Trigger almost immediately now that the debouncing is handled by markInteracted
        this.saveTimeouts.set(id, timeout);
    }

    private persistState(id: string, data: string, iframe: HTMLIFrameElement) {
        console.log("CircuitJS: Persisting state for", id);
        this.lastSavedState.set(id, data);
        const encoded = encodeURIComponent(data);

        // 1. Update local DOM attributes for immediate consistency
        const blockElement = this.findBlockElement(iframe);
        if (blockElement) {
            blockElement.setAttribute('custom-circuit', encoded);
        }

        // 2. Persist to SiYuan database
        fetchPost("/api/attr/setBlockAttrs", {
            id,
            attrs: { "custom-circuit": encoded }
        }, (res) => {
            if (res.code !== 0) {
                console.warn("CircuitJS: /api/attr failed, trying /api/block/setBlockAttrs", res);
                fetchPost("/api/block/setBlockAttrs", {
                    id,
                    attrs: { "custom-circuit": encoded }
                });
            }
        });
    }

    private findBlockElement(element: HTMLElement): HTMLElement | null {
        let parent: HTMLElement | null = element;
        while (parent && parent !== document.body) {
            if (parent.hasAttribute('data-node-id')) {
                return parent;
            }
            parent = parent.parentElement;
        }
        return null;
    }

    private saveToSiYuan(id: string) {
        const iframe = document.getElementById(`iframe-${id}`) as HTMLIFrameElement;
        const win = iframe?.contentWindow as any;
        if (win && win.circuitjs_dumpCircuit) {
            const data = win.circuitjs_dumpCircuit();
            this.persistState(id, data, iframe);
        }
    }

    private handleToolbarAction(target: HTMLElement) {
        const actionEl = target.closest("[data-action]") as HTMLElement;
        if (!actionEl) return;
        const action = actionEl.getAttribute("data-action");
        const id = actionEl.getAttribute("data-target-id");
        if (!action || !id) return;

        const iframe = document.getElementById(`iframe-${id}`) as HTMLIFrameElement;
        const win = iframe?.contentWindow as any;
        if (!win) return;

        switch (action) {
            case "run-pause": 
                if (win.circuitjs_setSimRunning && win.circuitjs_simIsRunning) {
                    const isRunning = win.circuitjs_simIsRunning();
                    console.log("CircuitJS: Toggling play/pause. Currently running:", isRunning);
                    win.circuitjs_setSimRunning(!isRunning);
                    actionEl.textContent = !isRunning ? "Pause" : "Play";
                } else {
                    console.warn("CircuitJS: setSimRunning API not found on window");
                }
                break;
            case "reset": win.circuitjs_resetAction?.(); break;
            case "undo": win.circuitjs_menuPerformed?.("key", "undo"); break;
            case "redo": win.circuitjs_menuPerformed?.("key", "redo"); break;
            case "toggle-sidebar":
                const sb = document.getElementById(`sidebar-${id}`);
                if (sb) {
                    sb.classList.toggle("collapsed");
                    actionEl.classList.toggle("active");
                    if (!sb.classList.contains("collapsed")) this.syncSliders(id, win);
                }
                break;
            case "export-code":
                const ta = document.getElementById(`code-${id}`) as HTMLTextAreaElement;
                if (ta && win.circuitjs_dumpCircuit) ta.value = win.circuitjs_dumpCircuit();
                break;
            case "import-code":
                const ita = document.getElementById(`code-${id}`) as HTMLTextAreaElement;
                if (ita?.value && win.circuitjs_readCircuit) {
                    win.circuitjs_readCircuit(ita.value);
                    this.saveToSiYuan(id);
                }
                break;
            case "save-to-siyuan": this.saveToSiYuan(id); break;
        }
    }

    private handleInputChange(event: Event) {
        const target = event.target as HTMLElement;
        const actionEl = target.closest("[data-action]") as HTMLInputElement | HTMLSelectElement;
        if (!actionEl) return;
        
        const action = actionEl.getAttribute("data-action");
        const id = actionEl.getAttribute("data-target-id");
        if (!action || !id) return;

        const iframe = document.getElementById(`iframe-${id}`) as HTMLIFrameElement;
        const win = iframe?.contentWindow as any;
        if (!win) return;

        if (action === "speed-slider") {
            const val = parseInt((actionEl as HTMLInputElement).value);
            win.circuitjs_setSimulationSpeed?.(val);
            const lb = document.getElementById(`val-speed-${id}`);
            if (lb) lb.textContent = val.toString();
        } else if (action === "current-slider") {
            const val = parseInt((actionEl as HTMLInputElement).value);
            win.circuitjs_setCurrentSpeed?.(val);
            const lb = document.getElementById(`val-current-${id}`);
            if (lb) lb.textContent = val.toString();
        } else if (action === "add-component") {
            let comp = (actionEl as HTMLSelectElement).value;
            if (comp) {
                // We use setMenuSelection instead of menuPerformed to ensure correct internal state,
                // and we no longer need the 'add-' padding hack because the compiled GWT bounds check bug
                // has been directly patched in the .cache.js files.
                if (win.circuitjs_setMenuSelection) {
                    win.circuitjs_setMenuSelection(comp);
                } else {
                    win.circuitjs_menuPerformed?.("main", comp);
                }
                // Reset selection to "Add Component..."
                (actionEl as HTMLSelectElement).value = "";
            }
        }
    }

    private syncSliders(id: string, win: any) {
        if (win.circuitjs_getSimulationSpeed) {
            const val = win.circuitjs_getSimulationSpeed();
            const s = document.querySelector(`#sidebar-${id} [data-action="speed-slider"]`) as HTMLInputElement;
            if (s) s.value = val;
            const lb = document.getElementById(`val-speed-${id}`);
            if (lb) lb.textContent = val;
        }
        if (win.circuitjs_getCurrentSpeed) {
            const val = win.circuitjs_getCurrentSpeed();
            const s = document.querySelector(`#sidebar-${id} [data-action="current-slider"]`) as HTMLInputElement;
            if (s) s.value = val;
            const lb = document.getElementById(`val-current-${id}`);
            if (lb) lb.textContent = val;
        }
    }

    onunload() {
        this.observer?.disconnect();
        window.removeEventListener('message', this.boundHandleMessage);
        for (const interval of this.pollingIntervals.values()) {
            clearInterval(interval);
        }
        this.pollingIntervals.clear();
        
        // Force save any pending dirty states immediately
        for (const [id, timeout] of this.saveTimeouts.entries()) {
            clearTimeout(timeout);
            console.log("CircuitJS: Force saving pending state on unload for", id);
            this.saveToSiYuan(id);
        }
        this.saveTimeouts.clear();
        this.isDirty.clear();

        console.log("CircuitJS Simulator Plugin unloaded");
    }

    private handleMessage(event: MessageEvent) {
        if (!event.data || typeof event.data !== 'object') return;
        
        if (event.data.type === 'circuitjs-ready') {
            const iframes = document.querySelectorAll('iframe');
            for (const iframe of Array.from(iframes)) {
                if (iframe.contentWindow === event.source) {
                    const blockElement = this.findBlockElement(iframe);
                    if (blockElement) {
                        const blockId = blockElement.getAttribute('data-node-id');
                        if (blockId) {
                            console.log("CircuitJS: Block ready via message", blockId);
                            this.ensureUIWrapper(iframe as HTMLIFrameElement, blockId);
                            this.bindIframe(iframe as HTMLIFrameElement, blockId);
                        }
                    }
                    break;
                }
            }
        }
    }
}
