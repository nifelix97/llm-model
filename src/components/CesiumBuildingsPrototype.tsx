import { useEffect, useRef, useState } from "react";
import * as Cesium from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";

type InitializationStatus = "initializing" | "ready" | "error";
type TileDiagnostics = {
  loaded: number;
  visible: number;
  failed: number;
  geometryTiles: number;
  geometryTriangles: number;
  pendingRequests: number;
  processingTiles: number;
  tilesetLoaded: boolean;
  featureCount: number | null;
  featureContentType: string | null;
  loadingState: "waiting" | "loading" | "loaded" | "no-visible-tiles";
};
type VisibilityDiagnostics = {
  frustum: string;
  tilesetVisible: boolean;
  clippingEnabled: boolean;
};

const KIGALI = { longitude: 30.0619, latitude: -1.9441 };
const OSM_BUILDINGS_ASSET_ID = 96188;
const INITIAL_DIAGNOSTICS: TileDiagnostics = {
  loaded: 0,
  visible: 0,
  failed: 0,
  geometryTiles: 0,
  geometryTriangles: 0,
  pendingRequests: 0,
  processingTiles: 0,
  tilesetLoaded: false,
  featureCount: null,
  featureContentType: null,
  loadingState: "waiting",
};

function safeErrorDetails(error: unknown, token: string) {
  const replaceToken = (value: string) =>
    token ? value.split(token).join("[redacted token]") : value;
  if (error instanceof Error) {
    return {
      name: error.name,
      message: replaceToken(error.message),
      stack: error.stack ? replaceToken(error.stack) : undefined,
    };
  }
  try {
    return replaceToken(JSON.stringify(error));
  } catch {
    return String(error);
  }
}

function metricsForTiles(
  tiles: Map<string, { count: number; type: string; supported: boolean; triangles: number }>,
) {
  const measured = [...tiles.values()].filter((tile) => tile.supported);
  const geometryTiles = [...tiles.values()].filter((tile) => tile.triangles > 0);
  return {
    count: measured.length
      ? measured.reduce((sum, tile) => sum + tile.count, 0)
      : null,
    type: measured.length
      ? [...new Set(measured.map((tile) => tile.type))].join(", ")
      : null,
    geometryTiles: geometryTiles.length,
    geometryTriangles: geometryTiles.reduce((sum, tile) => sum + tile.triangles, 0),
  };
}

/** Reversible opt-in comparison renderer. The dashboard's Three.js scene stays default. */
export default function CesiumBuildingsPrototype({ debug = false }: { debug?: boolean }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Cesium.Viewer | null>(null);
  const runtimeToken = (
    window as Window & { CESIUM_ION_ACCESS_TOKEN?: string }
  ).CESIUM_ION_ACCESS_TOKEN;
  const token =
    runtimeToken?.trim() ||
    import.meta.env.VITE_CESIUM_ION_ACCESS_TOKEN?.trim() ||
    "";
  const [initialization, setInitialization] =
    useState<InitializationStatus>(token ? "initializing" : "error");
  const [credentialStatus, setCredentialStatus] = useState(
    token ? "Configured · awaiting Cesium ion response" : "Missing",
  );
  const [message, setMessage] = useState(
    token
      ? "Creating viewer and requesting Cesium OSM Buildings…"
      : "Cesium ion token is not configured. Add VITE_CESIUM_ION_ACCESS_TOKEN to .env.local; the default Three.js map remains available.",
  );
  const [tiles, setTiles] = useState<TileDiagnostics>(INITIAL_DIAGNOSTICS);
  const [visibility, setVisibility] = useState<VisibilityDiagnostics | null>(null);
  const [boundingSphereSummary, setBoundingSphereSummary] = useState<string | null>(null);
  const loadedTilesRef = useRef(
    new Map<string, { count: number; type: string; supported: boolean; triangles: number }>(),
  );
  const visibleTilesThisFrameRef = useRef(new Set<string>());
  const lastVisibleCountRef = useRef(-1);
  const lastTilesetLoadedRef = useRef(false);
  const [generation, setGeneration] = useState(0);

  const flyToKigali = () => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(
        KIGALI.longitude,
        KIGALI.latitude,
        1350,
      ),
      orientation: {
        heading: Cesium.Math.toRadians(18),
        pitch: Cesium.Math.toRadians(-32),
        roll: 0,
      },
      duration: 1.2,
    });
  };

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !token) return;

    let disposed = false;
    let viewer: Cesium.Viewer | undefined;
    let buildings: Cesium.Cesium3DTileset | undefined;
    let failedTiles = 0;
    const loadedTileKeys = loadedTilesRef.current;
    const visibleTileKeys = visibleTilesThisFrameRef.current;

    const publishTileCounts = () => {
      if (disposed) return;
      const measured = metricsForTiles(loadedTileKeys);
      setTiles((current) => ({
        ...current,
        loaded: loadedTileKeys.size,
        failed: failedTiles,
        featureCount: measured.count,
        featureContentType: measured.type,
        geometryTiles: measured.geometryTiles,
        geometryTriangles: measured.geometryTriangles,
        loadingState:
          loadedTileKeys.size > 0
            ? "loaded"
            : current.loadingState === "loading"
              ? "loading"
              : "no-visible-tiles",
      }));
    };

    const onTileLoad = (tile: Cesium.Cesium3DTile) => {
      if (disposed) return;
      const content = tile.content;
      const contentType = content.constructor?.name || "unknown content";
      const supportsFeatureCount =
        Number.isFinite(content.featuresLength) &&
        typeof content.getFeature === "function";
      loadedTileKeys.set(content.url, {
        count: supportsFeatureCount ? content.featuresLength : 0,
        type: contentType,
        supported: supportsFeatureCount,
        triangles: Number.isFinite(content.trianglesLength)
          ? content.trianglesLength
          : 0,
      });
      publishTileCounts();
    };

    const onTileUnload = (tile: Cesium.Cesium3DTile) => {
      if (disposed) return;
      loadedTileKeys.delete(tile.content.url);
      visibleTileKeys.delete(tile.content.url);
      publishTileCounts();
    };

    const onTileVisible = (tile: Cesium.Cesium3DTile) => {
      if (disposed) return;
      visibleTileKeys.add(tile.content.url);
    };

    const onLoadProgress = (pendingRequests: number, processingTiles: number) => {
      if (disposed) return;
      setTiles((current) => ({
        ...current,
        pendingRequests,
        processingTiles,
        loadingState:
          pendingRequests + processingTiles > 0
            ? "loading"
            : current.visible > 0
              ? "loaded"
              : "no-visible-tiles",
      }));
    };

    const onTileFailed = (error: { url?: string; message?: string; statusCode?: number }) => {
      if (disposed) return;
      failedTiles += 1;
      const statusCode = error.statusCode;
      const detail = safeErrorDetails(error, token);
      console.error("Cesium OSM Buildings tile request failed:", detail);
      if (statusCode === 401 || statusCode === 403) {
        setCredentialStatus(`Rejected by Cesium ion (HTTP ${statusCode})`);
        setMessage("Cesium ion rejected the token or its access to the OSM Buildings asset.");
      } else {
        setMessage(`A building tile failed to load${statusCode ? ` (HTTP ${statusCode})` : ""}. See browser console for sanitized details.`);
      }
      publishTileCounts();
    };

    const start = async () => {
      try {
        if (disposed) return;
        Cesium.Ion.defaultAccessToken = token;
        viewer = new Cesium.Viewer(host, {
          animation: false,
          baseLayer: false,
          baseLayerPicker: false,
          fullscreenButton: false,
          geocoder: false,
          homeButton: false,
          infoBox: false,
          navigationHelpButton: false,
          sceneModePicker: false,
          selectionIndicator: false,
          timeline: false,
          terrainProvider: new Cesium.EllipsoidTerrainProvider(),
        });
        viewerRef.current = viewer;
        viewer.scene.globe.show = true;
        viewer.imageryLayers.addImageryProvider(
          new Cesium.UrlTemplateImageryProvider({
            url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
            credit: new Cesium.Credit("Imagery © Esri, Maxar, Earthstar Geographics"),
            maximumLevel: 19,
          }),
        );
        viewer.scene.screenSpaceCameraController.minimumZoomDistance = 4;
        viewer.camera.flyTo({
          destination: Cesium.Cartesian3.fromDegrees(
            KIGALI.longitude,
            KIGALI.latitude,
            1800,
          ),
          orientation: {
            heading: Cesium.Math.toRadians(18),
            pitch: Cesium.Math.toRadians(-32),
            roll: 0,
          },
          duration: 0,
        });

        if (debug) {
          viewer.entities.add({
            name: "Temporary Kigali diagnostic marker",
            position: Cesium.Cartesian3.fromDegrees(
              KIGALI.longitude,
              KIGALI.latitude,
              40,
            ),
            point: {
              pixelSize: 18,
              color: Cesium.Color.MAGENTA,
              outlineColor: Cesium.Color.WHITE,
              outlineWidth: 3,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
            label: {
              text: "Diagnostic marker · Kigali",
              font: "14px sans-serif",
              pixelOffset: new Cesium.Cartesian2(0, -24),
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
          });
        }

        setTiles(INITIAL_DIAGNOSTICS);
        setMessage("Requesting OSM Buildings asset 96188 from Cesium ion…");
        buildings = await Cesium.createOsmBuildingsAsync();
        if (disposed || viewer.isDestroyed()) {
          buildings.destroy();
          return;
        }

        buildings.tileLoad.addEventListener(onTileLoad);
        buildings.tileUnload.addEventListener(onTileUnload);
        buildings.tileVisible.addEventListener(onTileVisible);
        buildings.tileFailed.addEventListener(onTileFailed);
        buildings.loadProgress.addEventListener(onLoadProgress);
        buildings.maximumScreenSpaceError = 8;
        buildings.skipLevelOfDetail = false;
        viewer.scene.primitives.add(buildings);
        setInitialization("ready");
        setCredentialStatus("Accepted for OSM Buildings asset metadata; tile access still being checked");
        setTiles((current) => ({ ...current, loadingState: "loading" }));
        setMessage("Tileset initialized; waiting for visible building tiles. This does not yet confirm Kigali building coverage.");
        viewer.resize();

        // Start a second fly after the tileset is attached so Cesium traverses
        // its hierarchy around Kigali rather than a stale initial camera view.
        viewer.camera.flyTo({
          destination: Cesium.Cartesian3.fromDegrees(
            KIGALI.longitude,
            KIGALI.latitude,
            1350,
          ),
          orientation: {
            heading: Cesium.Math.toRadians(18),
            pitch: Cesium.Math.toRadians(-32),
            roll: 0,
          },
          duration: 1.2,
          complete: () => {
            if (disposed || !debug || !viewer || !buildings) return;
            const cameraPosition = Cesium.Cartographic.fromCartesian(
              viewer.camera.positionWC,
            );
            const frustum = viewer.camera.frustum.computeCullingVolume(
              viewer.camera.positionWC,
              viewer.camera.directionWC,
              viewer.camera.upWC,
            );
            console.info("Cesium Kigali camera diagnostics", {
              cameraPosition: {
                longitude: Cesium.Math.toDegrees(cameraPosition.longitude),
                latitude: Cesium.Math.toDegrees(cameraPosition.latitude),
                height: cameraPosition.height,
              },
              tilesetFrustumIntersection: frustum.computeVisibility(
                buildings.boundingSphere,
              ),
              tilesetShow: buildings.show,
              sceneContainsTileset: viewer.scene.primitives.contains(buildings),
            });
          },
        });

        const sphere = buildings.boundingSphere;
        const sphereCenter = Cesium.Cartographic.fromCartesian(sphere.center);
        const sphereDescription =
          `center ${Cesium.Math.toDegrees(sphereCenter.longitude).toFixed(4)}, ` +
          `${Cesium.Math.toDegrees(sphereCenter.latitude).toFixed(4)}, ` +
          `${sphereCenter.height.toFixed(0)} m; radius ${sphere.radius.toFixed(0)} m`;
        setBoundingSphereSummary(sphereDescription);
        if (debug) {
          console.info("Cesium OSM Buildings tileset diagnostics", {
            assetId: OSM_BUILDINGS_ASSET_ID,
            show: buildings.show,
            sceneContainsTileset: viewer.scene.primitives.contains(buildings),
            maximumScreenSpaceError: buildings.maximumScreenSpaceError,
            skipLevelOfDetail: buildings.skipLevelOfDetail,
            cullWithChildrenBounds: (
              buildings as Cesium.Cesium3DTileset & {
                _cullWithChildrenBounds?: boolean;
              }
            )._cullWithChildrenBounds,
            clippingPlanesEnabled: buildings.clippingPlanes?.enabled ?? false,
            boundingSphere: sphereDescription,
          });
        }

        const postRender = () => {
          if (disposed || !viewer || !buildings) return;
          const currentVisibleCount = visibleTileKeys.size;
          const currentTilesetLoaded = buildings.tilesLoaded;
          if (
            lastVisibleCountRef.current !== currentVisibleCount ||
            currentTilesetLoaded !== lastTilesetLoadedRef.current
          ) {
            lastVisibleCountRef.current = currentVisibleCount;
            lastTilesetLoadedRef.current = currentTilesetLoaded;
            setTiles((current) => ({
              ...current,
              visible: currentVisibleCount,
              tilesetLoaded: currentTilesetLoaded,
              loadingState:
                currentVisibleCount > 0
                  ? "loaded"
                  : current.loaded > 0
                    ? "loaded"
                    : "no-visible-tiles",
            }));
          }
          visibleTileKeys.clear();
          const frustum = viewer.camera.frustum.computeCullingVolume(
            viewer.camera.positionWC,
            viewer.camera.directionWC,
            viewer.camera.upWC,
          );
          const intersection = frustum.computeVisibility(buildings.boundingSphere);
          const frustumLabel =
            intersection === Cesium.Intersect.OUTSIDE
              ? "outside"
              : intersection === Cesium.Intersect.INSIDE
                ? "inside"
                : "intersecting";
          setVisibility((current) => {
            const next = {
              frustum: frustumLabel,
              tilesetVisible: buildings!.show,
              clippingEnabled: buildings!.clippingPlanes?.enabled ?? false,
            };
            return current && current.frustum === next.frustum &&
              current.tilesetVisible === next.tilesetVisible &&
              current.clippingEnabled === next.clippingEnabled
              ? current
              : next;
          });
        };
        viewer.scene.postRender.addEventListener(postRender);
        cleanupPostRender = () => viewer?.scene.postRender.removeEventListener(postRender);
      } catch (error) {
        if (disposed) return;
        const details = safeErrorDetails(error, token);
        console.error("Cesium OSM Buildings initialization failed:", details);
        const statusCode = (error as { statusCode?: number })?.statusCode;
        if (statusCode === 401 || statusCode === 403) {
          setCredentialStatus(`Rejected by Cesium ion (HTTP ${statusCode})`);
        } else {
          setCredentialStatus("Could not verify asset access");
        }
        setInitialization("error");
        const displayError = error instanceof Error
          ? `${error.name}: ${error.message.split(token).join("[redacted token]")}`
          : safeErrorDetails(error, token);
        setMessage(
          typeof displayError === "string"
            ? displayError
            : JSON.stringify(displayError),
        );
        if (buildings && !buildings.isDestroyed()) {
          buildings.tileLoad.removeEventListener(onTileLoad);
          buildings.tileUnload.removeEventListener(onTileUnload);
          buildings.tileVisible.removeEventListener(onTileVisible);
          buildings.tileFailed.removeEventListener(onTileFailed);
          buildings.loadProgress.removeEventListener(onLoadProgress);
        }
        if (viewer && !viewer.isDestroyed()) viewer.destroy();
        viewerRef.current = null;
        viewer = undefined;
      }
    };

    let cleanupPostRender: (() => void) | undefined;
    // The deferred start lets React Strict Mode's first setup/cleanup probe
    // cancel before constructing a viewer, avoiding duplicate initialization.
    const initTimer = window.setTimeout(() => void start(), 0);
    const resizeObserver = new ResizeObserver(() => viewer?.resize());
    resizeObserver.observe(host);
    return () => {
      disposed = true;
      window.clearTimeout(initTimer);
      resizeObserver.disconnect();
      cleanupPostRender?.();
      if (buildings && !buildings.isDestroyed()) {
        buildings.tileLoad.removeEventListener(onTileLoad);
        buildings.tileUnload.removeEventListener(onTileUnload);
        buildings.tileVisible.removeEventListener(onTileVisible);
        buildings.tileFailed.removeEventListener(onTileFailed);
        buildings.loadProgress.removeEventListener(onLoadProgress);
      }
      loadedTileKeys.clear();
      visibleTileKeys.clear();
      if (viewer && !viewer.isDestroyed()) viewer.destroy();
      if (viewerRef.current === viewer) viewerRef.current = null;
    };
  }, [debug, token, generation]);

  return (
    <div className="absolute inset-0 bg-[#07131b]">
      <div ref={hostRef} className="absolute inset-0" />
      <div className="absolute left-3 top-20 z-10 max-w-[min(90vw,36rem)] rounded border border-cyan-800/80 bg-[#061019]/95 p-2 font-mono text-[9px] leading-relaxed text-cyan-100 shadow-lg">
        <div className="font-semibold uppercase tracking-wider">
          Cesium prototype · initialization {initialization}
        </div>
        <div>Ion token / asset: {credentialStatus}</div>
        <div>{message}</div>
        <div>Building tiles loaded in cache: {tiles.loaded}</div>
        <div>Building tiles visible this frame: {tiles.visible}</div>
        <div>Loaded tiles with geometry: {tiles.geometryTiles} · triangles: {tiles.geometryTriangles}</div>
        <div>Tile loading: {tiles.loadingState} · pending: {tiles.pendingRequests} · processing: {tiles.processingTiles}</div>
        <div>Visible-view tileset loaded: {String(tiles.tilesetLoaded)} · tile failures: {tiles.failed}</div>
        {tiles.featureCount !== null ? (
          <div>
            Features reported by {tiles.featureContentType}: {tiles.featureCount}
          </div>
        ) : (
          <div>Feature count: unsupported by the currently loaded tile content</div>
        )}
        {visibility && (
          <div>
            Tileset show: {String(visibility.tilesetVisible)} · camera frustum: {visibility.frustum} · clipping: {String(visibility.clippingEnabled)}
          </div>
        )}
        {debug && boundingSphereSummary && <div>Tileset bounds: {boundingSphereSummary}</div>}
        {debug && <div>Magenta marker: temporary Kigali diagnostic marker</div>}
        <div className="mt-1 text-slate-400">
          Cesium OSM Buildings via Cesium ion · © OpenStreetMap contributors. Esri World Imagery · Elevation uses the ellipsoid in this prototype.
        </div>
        <button
          type="button"
          onClick={flyToKigali}
          className="pointer-events-auto mt-2 rounded border border-cyan-700 bg-cyan-950/80 px-2 py-1 text-cyan-100 hover:bg-cyan-900"
        >
          Fly to Kigali
        </button>
        {initialization === "error" && token && (
          <button
            type="button"
            onClick={() => {
              setInitialization("initializing");
              setCredentialStatus("Retrying Cesium ion asset request");
              setMessage("Retrying Cesium OSM Buildings initialization…");
              setGeneration((value) => value + 1);
            }}
            className="pointer-events-auto ml-2 mt-2 rounded border border-amber-700 bg-amber-950/80 px-2 py-1 text-amber-100 hover:bg-amber-900"
          >
            Retry initialization
          </button>
        )}
      </div>
    </div>
  );
}
