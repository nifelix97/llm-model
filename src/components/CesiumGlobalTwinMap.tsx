import { useEffect, useRef, useState } from "react";
import * as Cesium from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";
import type { PlanningFeature } from "../lib/ragApi";

export type TwinMapPoint = {
  id: string;
  name: string;
  detail: string;
  kind: string;
  lat: number;
  lon: number;
  height?: number;
  proposalId?: string;
};

export type TwinMapRoad = {
  id: number;
  name?: string;
  kind: string;
  geometry: { lat: number; lon: number }[];
};

export type TwinMapRoute = {
  id: string;
  name: string;
  kind: "drone";
  points: [number, number][];
};

export type TwinMapArea = {
  name: string;
  geometry: {
    type: "Polygon" | "MultiPolygon";
    coordinates: number[][][] | number[][][][];
  };
};

export type PlanningTool =
  | "none" | "zone" | "green_space" | "road" | "bridge" | "building"
  | "facility" | "school" | "clinic" | "water_point" | "market"
  | "utility" | "transit_hub" | "emergency_service" | "move";

type Props = {
  debug: boolean;
  groundView: boolean;
  rwandaFocus: boolean;
  mapStyle: "terrain" | "satellite";
  viewPreset: "oblique" | "top" | "low";
  layers: Record<string, boolean>;
  points: TwinMapPoint[];
  roads: TwinMapRoad[];
  routes: TwinMapRoute[];
  roadsStatus: "loading" | "ready" | "unavailable";
  areas: TwinMapArea[];
  selectedArea: string | null;
  policyFocusGeometries?: TwinMapArea[];
  areaSelectionEnabled: boolean;
  onSelectPoint: (point: TwinMapPoint) => void;
  onSelectArea: (name: string) => void;
  onSourceMetricsChange?: (metrics: TwinMapSourceMetrics) => void;
  planningMode?: boolean;
  planningTool?: PlanningTool;
  planningFeatures?: PlanningFeature[];
  planningVisible?: Record<string, boolean>;
  planningComparison?: boolean;
  selectedPlanningFeatureId?: string | null;
  onAddPlanningFeature?: (feature: PlanningFeature) => void;
  onUpdatePlanningFeature?: (feature: PlanningFeature) => void;
  onSelectPlanningFeature?: (id: string) => void;
};

export type SourceState = "loading" | "ready" | "fallback" | "unavailable";

export type TwinMapSourceMetrics = {
  terrain: SourceState;
  buildings: SourceState;
  buildingTilesLoaded: number;
  buildingTilesVisible: number;
  buildingTileErrors: number;
  imageryErrors: number;
  topographicErrors: number;
};

const KIGALI: [number, number] = [30.0619, -1.9441];
const kindColors: Record<string, Cesium.Color> = {
  maritime: Cesium.Color.CYAN,
  satellites: Cesium.Color.MEDIUMPURPLE,
  cctv: Cesium.Color.GOLD,
  earthquakes: Cesium.Color.HOTPINK,
  incidents: Cesium.Color.ORANGE,
  cables: Cesium.Color.DODGERBLUE,
  drones: Cesium.Color.LIMEGREEN,
  traffic: Cesium.Color.RED,
};

export default function CesiumGlobalTwinMap(props: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Cesium.Viewer | null>(null);
  const overlayRef = useRef<Cesium.CustomDataSource | null>(null);
  const planningRef = useRef<Cesium.CustomDataSource | null>(null);
  const propsRef = useRef(props);
  const propsForPlanningRef = useRef(props);
  const [viewerReady, setViewerReady] = useState(false);
  const [terrainState, setTerrainState] = useState<SourceState>("loading");
  const [buildingState, setBuildingState] = useState<SourceState>("loading");
  const [imageryErrors, setImageryErrors] = useState(0);
  const [topographicErrors, setTopographicErrors] = useState(0);
  const [buildingErrors, setBuildingErrors] = useState(0);
  const [tileCounts, setTileCounts] = useState({ loaded: 0, visible: 0 });
  const [cameraInfo, setCameraInfo] = useState("waiting for camera");
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    props.onSourceMetricsChange?.({
      terrain: terrainState,
      buildings: buildingState,
      buildingTilesLoaded: tileCounts.loaded,
      buildingTilesVisible: tileCounts.visible,
      buildingTileErrors: buildingErrors,
      imageryErrors,
      topographicErrors,
    });
  }, [props.onSourceMetricsChange, terrainState, buildingState, tileCounts, buildingErrors, imageryErrors, topographicErrors]);

  useEffect(() => {
    propsRef.current = props;
    propsForPlanningRef.current = props;
  }, [props]);
  const token = (
    window as Window & { CESIUM_ION_ACCESS_TOKEN?: string }
  ).CESIUM_ION_ACCESS_TOKEN?.trim() || import.meta.env.VITE_CESIUM_ION_ACCESS_TOKEN?.trim() || "";

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    let viewer: Cesium.Viewer | undefined;
    let buildings: Cesium.Cesium3DTileset | undefined;
    let cleanupResize = () => {};
    let cleanupClick = () => {};
    let cleanupImageryError = () => {};
    let cleanupTerrainError = () => {};
    const loadedTiles = new Set<string>();
    const visibleTiles = new Set<string>();
    const postRender = () => {
      if (!viewer || viewer.isDestroyed()) return;
      if (propsRef.current.debug) {
        const cartographic = Cesium.Cartographic.fromCartesian(viewer.camera.positionWC);
        setCameraInfo(
          `${Cesium.Math.toDegrees(cartographic.longitude).toFixed(5)}, ${Cesium.Math.toDegrees(cartographic.latitude).toFixed(5)} · ${Math.round(cartographic.height).toLocaleString()} m`,
        );
      }
      setTileCounts((current) =>
        current.loaded === loadedTiles.size && current.visible === visibleTiles.size
          ? current
          : { loaded: loadedTiles.size, visible: visibleTiles.size },
      );
      visibleTiles.clear();
    };
    const onTileLoad = (tile: Cesium.Cesium3DTile) => loadedTiles.add(tile.content.url);
    const onTileUnload = (tile: Cesium.Cesium3DTile) => loadedTiles.delete(tile.content.url);
    const onTileVisible = (tile: Cesium.Cesium3DTile) => visibleTiles.add(tile.content.url);
    const onTileFailed = (error: unknown) => {
      setBuildingErrors((count) => count + 1);
      console.error("Cesium OSM Buildings tile request failed:", error);
    };

    const initialize = async () => {
      try {
        if (cancelled) return;
        if (token) Cesium.Ion.defaultAccessToken = token;
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
          requestRenderMode: false,
          terrainProvider: new Cesium.EllipsoidTerrainProvider(),
        });
        viewerRef.current = viewer;
        viewer.scene.globe.depthTestAgainstTerrain = true;
        viewer.scene.screenSpaceCameraController.minimumZoomDistance = 3;
        viewer.scene.screenSpaceCameraController.maximumZoomDistance = 35_000_000;
        viewer.scene.screenSpaceCameraController.enableCollisionDetection = true;
        viewer.scene.globe.maximumScreenSpaceError = 1.5;
        viewer.scene.postRender.addEventListener(postRender);

        const imagery = new Cesium.UrlTemplateImageryProvider({
          url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
          credit: new Cesium.Credit("Imagery © Esri, Maxar, Earthstar Geographics"),
          maximumLevel: 19,
        });
        const onImageryError = (error: unknown) => {
          if (cancelled) return;
          setImageryErrors((count) => count + 1);
          console.error("Esri World Imagery request failed:", error);
        };
        imagery.errorEvent.addEventListener(onImageryError);
        cleanupImageryError = () => imagery.errorEvent.removeEventListener(onImageryError);
        viewer.imageryLayers.addImageryProvider(imagery);
        viewer.camera.flyTo({
          destination: Cesium.Cartesian3.fromDegrees(0, 0, 18_000_000),
          orientation: { heading: 0, pitch: Cesium.Math.toRadians(-90), roll: 0 },
          duration: 0,
        });
        if (propsRef.current.debug) {
          viewer.entities.add({
            name: "Temporary Kigali diagnostic marker",
            position: Cesium.Cartesian3.fromDegrees(...KIGALI, 40),
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

        const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
        cleanupClick = () => handler.destroy();
        handler.setInputAction((movement: { position: Cesium.Cartesian2 }) => {
          if (propsRef.current.planningMode) return;
          const picked = viewer?.scene.pick(movement.position);
          const entity = picked && "id" in picked ? picked.id as Cesium.Entity : undefined;
          const properties = entity?.properties?.getValue(Cesium.JulianDate.now()) as
            | { twinPoint?: TwinMapPoint; areaName?: string }
            | undefined;
          if (properties?.twinPoint) propsRef.current.onSelectPoint(properties.twinPoint);
          if (properties?.areaName && propsRef.current.areaSelectionEnabled)
            propsRef.current.onSelectArea(properties.areaName);
        }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

        setViewerReady(true);

        const resizeObserver = new ResizeObserver(() => viewer?.resize());
        resizeObserver.observe(host);
        cleanupResize = () => resizeObserver.disconnect();

        if (token) {
          void Cesium.createWorldTerrainAsync()
            .then((terrain) => {
              if (cancelled || !viewer || viewer.isDestroyed()) return;
              viewer.terrainProvider = terrain;
              const onTerrainError = (error: unknown) => {
                if (cancelled) return;
                setTerrainState("unavailable");
                console.error("Cesium World Terrain tile request failed:", error);
              };
              terrain.errorEvent.addEventListener(onTerrainError);
              cleanupTerrainError = () => terrain.errorEvent.removeEventListener(onTerrainError);
              setTerrainState("ready");
            })
            .catch((error: unknown) => {
              if (cancelled) return;
              setTerrainState("fallback");
              console.error("Cesium World Terrain unavailable; using ellipsoid:", error);
            })
            .catch(() => {});
          try {
            buildings = await Cesium.createOsmBuildingsAsync();
            if (cancelled || viewer.isDestroyed()) {
              buildings.destroy();
              return;
            }
            buildings.maximumScreenSpaceError = 4;
            buildings.tileLoad.addEventListener(onTileLoad);
            buildings.tileUnload.addEventListener(onTileUnload);
            buildings.tileVisible.addEventListener(onTileVisible);
            buildings.tileFailed.addEventListener(onTileFailed);
            viewer.scene.primitives.add(buildings);
            setBuildingState("ready");
            if (propsRef.current.groundView) flyToRwanda(viewer, propsRef.current.viewPreset);
          } catch (error) {
            if (cancelled) return;
            setBuildingState("unavailable");
            console.error("Cesium OSM Buildings could not be initialized:", error);
          }
        } else {
          setTerrainState("fallback");
          setBuildingState("unavailable");
        }

      } catch (error) {
        if (cancelled) return;
        setViewerReady(false);
        console.error("Cesium viewer initialization failed:", error);
        if (viewer && !viewer.isDestroyed()) viewer.destroy();
        if (viewerRef.current === viewer) viewerRef.current = null;
      }
    };

    const initTimer = window.setTimeout(() => void initialize(), 0);
    return () => {
      cancelled = true;
      window.clearTimeout(initTimer);
      cleanupResize();
      cleanupClick();
      cleanupImageryError();
      cleanupTerrainError();
      if (viewer && !viewer.isDestroyed()) {
        viewer.scene.postRender.removeEventListener(postRender);
        if (buildings && !buildings.isDestroyed()) {
          buildings.tileLoad.removeEventListener(onTileLoad);
          buildings.tileUnload.removeEventListener(onTileUnload);
          buildings.tileVisible.removeEventListener(onTileVisible);
          buildings.tileFailed.removeEventListener(onTileFailed);
        }
        viewer.destroy();
      }
      if (viewerRef.current === viewer) viewerRef.current = null;
    };
  }, [token, retryKey]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewerReady || !viewer || viewer.isDestroyed()) return;
    const layers = viewer.imageryLayers;
    if (layers.length > 0) layers.get(0).show = props.mapStyle === "satellite";
    viewer.scene.globe.enableLighting = props.layers.dayNight;
    if (props.mapStyle === "terrain") {
      let layer = layers.length > 1 ? layers.get(1) : undefined;
      if (!layer) {
        const topo = new Cesium.UrlTemplateImageryProvider({
          url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}",
          credit: new Cesium.Credit("Basemap © Esri"),
          maximumLevel: 19,
        });
        topo.errorEvent.addEventListener((error) => {
          setTopographicErrors((count) => count + 1);
          console.error("Esri World Topographic Map request failed:", error);
        });
        layer = layers.addImageryProvider(topo);
      }
      layer.show = true;
    } else if (layers.length > 1) {
      layers.get(1).show = false;
    }
  }, [viewerReady, props.mapStyle, props.layers.dayNight]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewerReady || !viewer || viewer.isDestroyed()) return;
    if (props.groundView) flyToRwanda(viewer, props.viewPreset);
    else if (props.rwandaFocus) flyToCountry(viewer);
    else flyToWorld(viewer);
  }, [viewerReady, props.groundView, props.rwandaFocus, props.viewPreset]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewerReady || !viewer || viewer.isDestroyed()) return;
    if (overlayRef.current) viewer.dataSources.remove(overlayRef.current, true);
    const overlays = new Cesium.CustomDataSource("SAN Global Twin application layers");
    const areaNames = new Set<string>();
    const addedPointIds = new Set<string>();
    for (const point of props.points) {
      // Keep the overlay resilient if a future data source supplies duplicate IDs.
      if (addedPointIds.has(point.id)) {
        console.warn(`Skipping duplicate Cesium twin point ID: ${point.id}`);
        continue;
      }
      addedPointIds.add(point.id);
      if (!props.layers[point.kind]) continue;
      if ((props.groundView || props.rwandaFocus) && !withinRwanda(point.lat, point.lon)) continue;
      const color = kindColors[point.kind] ?? Cesium.Color.CYAN;
      overlays.entities.add({
        id: `twin-point-${point.id}`,
        name: point.name,
        description: point.detail,
        position: Cesium.Cartesian3.fromDegrees(point.lon, point.lat, point.height ?? 0),
        point: {
          pixelSize: point.id === "KGL-001" ? 12 : 8,
          color,
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 1,
          heightReference: point.height === undefined ? Cesium.HeightReference.CLAMP_TO_GROUND : Cesium.HeightReference.NONE,
          disableDepthTestDistance: 100_000,
        },
        label: {
          text: point.name,
          font: "11px sans-serif",
          fillColor: Cesium.Color.WHITE,
          showBackground: true,
          backgroundColor: Cesium.Color.fromCssColorString("#061019").withAlpha(0.8),
          pixelOffset: new Cesium.Cartesian2(0, -14),
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 180_000),
          heightReference: point.height === undefined ? Cesium.HeightReference.CLAMP_TO_GROUND : Cesium.HeightReference.NONE,
        },
        properties: { twinPoint: point },
      });
    }
    if (props.layers.roads && (props.groundView || props.rwandaFocus)) {
      for (const road of props.roads) {
        if (road.geometry.length < 2) continue;
        overlays.entities.add({
          id: `rwanda-road-${road.id}`,
          name: road.name || road.kind,
          polyline: {
            positions: Cesium.Cartesian3.fromDegreesArray(
              road.geometry.flatMap((point) => [point.lon, point.lat]),
            ),
            width: road.kind === "road" ? 2.5 : 1.5,
            material: road.kind === "road" ? Cesium.Color.fromCssColorString("#f4c95d") : Cesium.Color.CYAN,
            clampToGround: true,
          },
        });
      }
    }
    if (props.layers.drones && (props.groundView || props.rwandaFocus)) {
      for (const route of props.routes) {
        overlays.entities.add({
          id: `drone-route-${route.id}`,
          name: `${route.name} · simulated route`,
          polyline: {
            positions: Cesium.Cartesian3.fromDegreesArray(
              route.points.flatMap(([lat, lon]) => [lon, lat]),
            ),
            width: 2,
            material: new Cesium.PolylineDashMaterialProperty({
              color: Cesium.Color.LIMEGREEN.withAlpha(0.75),
              dashLength: 12,
            }),
            clampToGround: true,
          },
        });
      }
    }
    for (const area of props.areas) {
      if (areaNames.has(area.name)) continue;
      areaNames.add(area.name);
      const polygons = area.geometry.type === "Polygon"
        ? [area.geometry.coordinates as number[][][]]
        : area.geometry.coordinates as number[][][][];
      for (const [polygonIndex, polygon] of polygons.entries()) {
        const outer = polygon[0];
        if (!outer || outer.length < 4) continue;
        const coords = outer.flatMap(([lon, lat]) => [lon, lat]);
        const selected = area.name === props.selectedArea;
        overlays.entities.add({
          id: `area-${area.name}-${polygonIndex}`,
          name: area.name,
          polygon: {
            hierarchy: Cesium.Cartesian3.fromDegreesArray(coords),
            material: (selected ? Cesium.Color.CYAN : Cesium.Color.TRANSPARENT).withAlpha(0.015),
            outline: true,
            outlineColor: selected ? Cesium.Color.CYAN : Cesium.Color.fromCssColorString("#36b9ca").withAlpha(0.65),
            outlineWidth: selected ? 3 : 1,
            height: 0,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            classificationType: Cesium.ClassificationType.TERRAIN,
          },
          properties: { areaName: area.name },
        });
      }
    }
    for (const area of props.policyFocusGeometries ?? []) {
      const polygons = area.geometry.type === "Polygon"
        ? [area.geometry.coordinates as number[][][]]
        : area.geometry.coordinates as number[][][][];
      for (const [polygonIndex, polygon] of polygons.entries()) {
        const outer = polygon[0];
        if (!outer || outer.length < 4) continue;
        const coords = outer.flatMap(([lon, lat]) => [lon, lat]);
        overlays.entities.add({
          id: `policy-focus-fill-${area.name}-${polygonIndex}`,
          name: `Policy focus · ${area.name} District (administrative boundary)`,
          polygon: {
            hierarchy: Cesium.Cartesian3.fromDegreesArray(coords),
            material: Cesium.Color.ORANGE.withAlpha(0.1),
            outline: false,
            height: 0,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            classificationType: Cesium.ClassificationType.TERRAIN,
          },
        });
        overlays.entities.add({
          id: `policy-focus-glow-${area.name}-${polygonIndex}`,
          name: `Policy focus boundary · ${area.name} District (administrative boundary)`,
          polyline: {
            positions: Cesium.Cartesian3.fromDegreesArray(coords),
            width: 10,
            material: new Cesium.PolylineGlowMaterialProperty({
              color: Cesium.Color.ORANGE.withAlpha(0.9),
              glowPower: 0.24,
            }),
            clampToGround: true,
          },
        });
      }
    }
    viewer.dataSources.add(overlays);
    overlayRef.current = overlays;

    let removeTrafficTick = () => {};
    const trafficRoads = props.roads.filter(
      (road) => road.kind === "road" && road.geometry.length >= 2,
    );
    if (props.layers.traffic && (props.groundView || props.rwandaFocus) && trafficRoads.length) {
      const traffic = Array.from({ length: 60 }, (_, index) => {
        const road = trafficRoads[index % trafficRoads.length];
        const path = road.geometry;
        const lengths = [0];
        for (let i = 1; i < path.length; i += 1) {
          lengths.push(lengths[i - 1] + distanceMeters(path[i - 1], path[i]));
        }
        const total = lengths[lengths.length - 1];
        if (!total) return null;
        const position = overlays.entities.add({
          id: `simulated-traffic-${index}`,
          name: "Simulated vehicle · not live traffic data",
          description: "A visualization simulation placed on a mapped Rwanda GIS road; this is not observed traffic telemetry.",
          position: Cesium.Cartesian3.fromDegrees(path[0].lon, path[0].lat),
          point: {
            pixelSize: 5,
            color: [Cesium.Color.RED, Cesium.Color.ORANGE, Cesium.Color.CYAN][index % 3],
            outlineColor: Cesium.Color.WHITE,
            outlineWidth: 1,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            disableDepthTestDistance: 40_000,
          },
        });
        return {
          path,
          lengths,
          total,
          distance: total * ((index * 0.61803398875) % 1),
          direction: index % 2 ? 1 : -1,
          speed: 7 + (index % 9) * 1.7,
          position,
        };
      }).filter((agent): agent is NonNullable<typeof agent> => agent !== null);
      let previousTime: Cesium.JulianDate | undefined;
      const updateTraffic = (clock: Cesium.Clock) => {
        if (!previousTime) {
          previousTime = Cesium.JulianDate.clone(clock.currentTime);
          return;
        }
        const elapsed = Math.min(0.5, Math.max(0, Cesium.JulianDate.secondsDifference(clock.currentTime, previousTime)));
        previousTime = Cesium.JulianDate.clone(clock.currentTime, previousTime);
        traffic.forEach((agent) => {
          agent.distance += elapsed * agent.speed * agent.direction;
          if (agent.distance < 0 || agent.distance > agent.total) {
            agent.direction *= -1;
            agent.distance = Math.max(0, Math.min(agent.total, agent.distance));
          }
          const coord = coordinateOnPath(agent.path, agent.lengths, agent.distance);
          agent.position.position = new Cesium.ConstantPositionProperty(
            Cesium.Cartesian3.fromDegrees(coord.lon, coord.lat),
          );
        });
      };
      viewer.clock.onTick.addEventListener(updateTraffic);
      removeTrafficTick = () => viewer?.clock.onTick.removeEventListener(updateTraffic);
    }
    return () => removeTrafficTick();
  }, [viewerReady, props.points, props.roads, props.routes, props.areas, props.layers, props.selectedArea, props.policyFocusGeometries, props.groundView, props.rwandaFocus]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewerReady || !viewer || viewer.isDestroyed()) return;
    if (planningRef.current) viewer.dataSources.remove(planningRef.current, true);
    planningRef.current = null;
    if (!props.planningMode) return;
    const source = new Cesium.CustomDataSource("SAN proposed planning features");
    const visibility = props.planningVisible ?? {};
    for (const feature of props.planningFeatures ?? []) {
      const p = feature.properties;
      const layer = String(p.layer ?? "proposed-zone");
      if (visibility[layer] === false) continue;
      const selected = feature.id === props.selectedPlanningFeatureId;
      const color = typeof p.color === "string" ? Cesium.Color.fromCssColorString(p.color) : Cesium.Color.fromCssColorString("#28d7c5");
      if (feature.geometry.type === "Point") {
        const [lon, lat] = feature.geometry.coordinates as number[];
        source.entities.add({ id: `planning-${feature.id}`, name: String(p.name ?? p.intendedUse ?? "Proposed facility"), position: Cesium.Cartesian3.fromDegrees(lon, lat), point: { pixelSize: selected ? 15 : 11, color: color.withAlpha(props.planningComparison ? 0.55 : 1), outlineColor: Cesium.Color.WHITE, outlineWidth: 2, heightReference: Cesium.HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: 5000 }, properties: { planningFeatureId: feature.id } });
        continue;
      }
      if (feature.geometry.type === "LineString") {
        const coords = feature.geometry.coordinates as number[][];
        source.entities.add({ id: `planning-${feature.id}`, name: String(p.name ?? "Proposed road"), polyline: { positions: Cesium.Cartesian3.fromDegreesArray(coords.flatMap((c) => [c[0], c[1]])), width: selected ? 5 : 3, material: color.withAlpha(props.planningComparison ? 0.4 : 0.9), clampToGround: true }, properties: { planningFeatureId: feature.id } });
        if (selected) addVertexHandles(source, feature.id, coords);
        continue;
      }
      const rings = feature.geometry.coordinates as number[][][];
      const outer = rings[0];
      if (!outer || outer.length < 4) continue;
      const isBuilding = layer === "proposed-building";
      const floors = Number(p.floors ?? 1);
      const height = Math.max(2.5, Number(p.height ?? floors * 3.2));
      source.entities.add({ id: `planning-${feature.id}`, name: String(p.name ?? (isBuilding ? "Proposed building" : "Proposed planning zone")), polygon: { hierarchy: Cesium.Cartesian3.fromDegreesArray(outer.flatMap((c) => [c[0], c[1]])), material: color.withAlpha(props.planningComparison ? 0.12 : isBuilding ? 0.62 : 0.2), outline: true, outlineColor: selected ? Cesium.Color.WHITE : color, outlineWidth: selected ? 3 : props.planningComparison ? 1.5 : 2, height: 0, heightReference: Cesium.HeightReference.CLAMP_TO_GROUND, ...(isBuilding ? { extrudedHeight: height, extrudedHeightReference: Cesium.HeightReference.RELATIVE_TO_GROUND } : {}) }, properties: { planningFeatureId: feature.id } });
      if (selected) addVertexHandles(source, feature.id, outer.slice(0, -1));
    }
    void viewer.dataSources.add(source);
    planningRef.current = source;
    return () => {
      if (!viewer.isDestroyed()) viewer.dataSources.remove(source, true);
      if (planningRef.current === source) planningRef.current = null;
    };
  }, [viewerReady, props.planningMode, props.planningFeatures, props.planningVisible, props.planningComparison, props.selectedPlanningFeatureId]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!props.planningMode || !viewerReady || !viewer || viewer.isDestroyed()) return;
    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    handler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
    let draft: [number, number][] = [];
    let draftEntities: Cesium.Entity[] = [];
    let dragging: { featureId: string; vertexIndex: number } | null = null;
    const clearDraft = () => {
      draftEntities.forEach((entity) => viewer.entities.remove(entity));
      draftEntities = [];
    };
    const worldCoordinate = (position: Cesium.Cartesian2): [number, number] | null => {
      const ray = viewer.camera.getPickRay(position);
      const world = ray ? viewer.scene.globe.pick(ray, viewer.scene) ?? viewer.camera.pickEllipsoid(position, viewer.scene.globe.ellipsoid) : null;
      if (!world) return null;
      const c = Cesium.Cartographic.fromCartesian(world);
      return [Cesium.Math.toDegrees(c.longitude), Cesium.Math.toDegrees(c.latitude)];
    };
    const finish = () => {
      const { planningTool = "none", onAddPlanningFeature } = propsForPlanningRef.current;
      const pointTools = ["facility", "school", "clinic", "water_point", "market", "utility", "transit_hub", "emergency_service"];
      const lineTool = planningTool === "road" || planningTool === "bridge";
      const polygonTool = planningTool === "zone" || planningTool === "building" || planningTool === "green_space";
      if (pointTools.includes(planningTool) || planningTool === "move" || planningTool === "none") return;
      if (lineTool && draft.length < 2) return;
      if (polygonTool && draft.length < 3) return;
      if (polygonTool && !isSimplePlanningRing([...draft, draft[0]])) {
        window.dispatchEvent(new CustomEvent("planning-drawing-error", { detail: "This polygon crosses itself. Adjust the vertices and try again." }));
        clearDraft();
        draft = [];
        return;
      }
      const layer = lineTool ? "proposed-road" : planningTool === "building" ? "proposed-building" : "proposed-zone";
      const coordinates = lineTool ? draft : [...draft, draft[0]];
      const category = planningTool === "bridge" ? "bridge alignment" : planningTool === "green_space" ? "green space" : planningTool;
      const name = planningTool === "road" ? "Proposed road" : planningTool === "bridge" ? "Proposed bridge alignment" : planningTool === "building" ? "Proposed building" : planningTool === "green_space" ? "Proposed green space" : "Proposed zone";
      const feature: PlanningFeature = { type: "Feature", id: crypto.randomUUID(), geometry: { type: lineTool ? "LineString" : "Polygon", coordinates: lineTool ? coordinates : [coordinates] }, properties: { layer, name, category, intendedUse: category, color: planningTool === "building" ? "#f59e0b" : lineTool ? "#fbbf24" : planningTool === "green_space" ? "#4ade80" : "#22d3ee", floors: 2, height: 6.4, status: "Proposed", implementation_status: "not_started", implementation_progress: null } };
      onAddPlanningFeature?.(feature);
      clearDraft();
      draft = [];
    };
    handler.setInputAction((event: { position: Cesium.Cartesian2 }) => {
      const current = propsForPlanningRef.current;
      const picked = viewer.scene.pick(event.position);
      const pickedValue = picked && "id" in picked ? (picked as { id: unknown }).id : undefined;
      const pickedId = typeof pickedValue === "string" ? pickedValue : pickedValue instanceof Cesium.Entity ? pickedValue.id : "";
      const vertexMatch = /^planning-vertex-(.+)-(\d+)$/.exec(pickedId);
      if (vertexMatch && current.selectedPlanningFeatureId === vertexMatch[1]) {
        dragging = { featureId: vertexMatch[1], vertexIndex: Number(vertexMatch[2]) };
        return;
      }
      if (pickedId.startsWith("planning-")) {
        const featureId = pickedId.slice("planning-".length);
        if (!pickedId.startsWith("planning-vertex-")) current.onSelectPlanningFeature?.(featureId);
        if (current.planningTool !== "none") return;
      }
      const coordinate = worldCoordinate(event.position);
      if (!coordinate) return;
      const pointPresets: Record<string, { name: string; intendedUse: string; color: string }> = {
        facility: { name: "Proposed facility", intendedUse: "Public facility", color: "#34d399" },
        school: { name: "Proposed school", intendedUse: "School", color: "#60a5fa" },
        clinic: { name: "Proposed clinic", intendedUse: "Health clinic", color: "#fb7185" },
        water_point: { name: "Proposed water point", intendedUse: "Water point", color: "#38bdf8" },
        market: { name: "Proposed market", intendedUse: "Market", color: "#fbbf24" },
        utility: { name: "Proposed utility site", intendedUse: "Utility site", color: "#c084fc" },
        transit_hub: { name: "Proposed transit hub", intendedUse: "Transit hub", color: "#fb923c" },
        emergency_service: { name: "Proposed emergency service", intendedUse: "Emergency service", color: "#f87171" },
      };
      const pointPreset = current.planningTool ? pointPresets[current.planningTool] : undefined;
      if (pointPreset) {
        current.onAddPlanningFeature?.({ type: "Feature", id: crypto.randomUUID(), geometry: { type: "Point", coordinates: coordinate }, properties: { layer: "proposed-facility", name: pointPreset.name, intendedUse: pointPreset.intendedUse, category: pointPreset.intendedUse, color: pointPreset.color, status: "Proposed", implementation_status: "not_started", implementation_progress: null } });
      } else if (current.planningTool === "move" && current.selectedPlanningFeatureId) {
        const feature = current.planningFeatures?.find((item) => item.id === current.selectedPlanningFeatureId);
        if (feature) current.onUpdatePlanningFeature?.(translateFeature(feature, coordinate));
      } else if (["zone", "green_space", "road", "bridge", "building"].includes(current.planningTool ?? "")) {
        if (!draft.length) clearDraft();
        if (draft.length) {
          const [lastLon, lastLat] = draft[draft.length - 1];
          const dx = (coordinate[0] - lastLon) * Math.cos(coordinate[1] * Math.PI / 180) * 111_320;
          const dy = (coordinate[1] - lastLat) * 111_320;
          if (Math.hypot(dx, dy) < 1.5) return;
        }
        draft.push(coordinate);
        clearDraft();
        const positions = Cesium.Cartesian3.fromDegreesArray(draft.flatMap((c) => [c[0], c[1]]));
        if (draft.length > 1) draftEntities.push(viewer.entities.add({ polyline: { positions, width: 3, material: Cesium.Color.YELLOW } }));
        if ((current.planningTool === "zone" || current.planningTool === "green_space" || current.planningTool === "building") && draft.length > 2) draftEntities.push(viewer.entities.add({ polygon: { hierarchy: positions, material: current.planningTool === "green_space" ? Cesium.Color.LIMEGREEN.withAlpha(0.2) : Cesium.Color.CYAN.withAlpha(0.15), outline: true, outlineColor: current.planningTool === "green_space" ? Cesium.Color.LIMEGREEN : Cesium.Color.CYAN } }));
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
    handler.setInputAction(finish, Cesium.ScreenSpaceEventType.RIGHT_CLICK);
    handler.setInputAction((event: { endPosition: Cesium.Cartesian2 }) => {
      if (!dragging) return;
      const coordinate = worldCoordinate(event.endPosition);
      const feature = propsForPlanningRef.current.planningFeatures?.find((item) => item.id === dragging?.featureId);
      if (coordinate && feature) propsForPlanningRef.current.onUpdatePlanningFeature?.(moveVertex(feature, dragging.vertexIndex, coordinate));
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
    handler.setInputAction(() => { dragging = null; }, Cesium.ScreenSpaceEventType.LEFT_UP);
    handler.setInputAction(finish, Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { clearDraft(); draft = []; dragging = null; }
      const target = event.target;
      const editingText = target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
      if (event.key === "Delete" && !editingText && propsForPlanningRef.current.selectedPlanningFeatureId) {
        window.dispatchEvent(new CustomEvent("planning-delete-selected"));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => { clearDraft(); handler.destroy(); window.removeEventListener("keydown", onKey); };
  }, [viewerReady, props.planningMode]);

  return (
    <div className="absolute inset-0 bg-[#07131b]">
      <div ref={hostRef} className="absolute inset-0" />
      {!props.debug && (
        <div className="absolute bottom-3 left-3 z-10 rounded bg-[#061019]/90 px-2 py-1 font-mono text-[9px] text-cyan-100">
          Terrain {terrainState} · OSM Buildings {buildingState === "ready" ? "tileset ready; coverage unverified" : buildingState} · Rwanda roads {props.roadsStatus}
        </div>
      )}
      <div className="pointer-events-none absolute bottom-3 right-3 z-10 rounded bg-white/95 px-2 py-1 font-sans text-[10px] text-slate-700 shadow">
        {props.mapStyle === "satellite" ? "Imagery © Esri, Maxar, Earthstar Geographics" : "Basemap © Esri"}
        <span> · © OpenStreetMap contributors</span>
      </div>
      {props.debug && <div className="absolute left-3 top-20 z-10 max-w-[min(90vw,33rem)] rounded border border-cyan-800/80 bg-[#061019]/95 p-2 font-mono text-[9px] leading-relaxed text-cyan-100 shadow-lg">
        <div className="font-semibold uppercase tracking-wider">Cesium Global Twin · {viewerReady ? "ready" : "initializing"}</div>
        <div>Terrain: {terrainState === "ready" ? "Cesium World Terrain" : terrainState === "fallback" ? "ellipsoid fallback (ion token/access required)" : terrainState === "unavailable" ? "World Terrain request error; provider remains active" : terrainState}</div>
        <div>OSM Buildings: {buildingState === "ready" ? "tileset attached; coverage requires loaded visible tiles" : buildingState}{buildingErrors > 0 ? ` · tile errors ${buildingErrors}` : ""}</div>
        <div>Rwanda GIS roads: {props.roadsStatus} · features {props.roads.length}</div>
        <div>Camera lon/lat/alt: {cameraInfo}</div>
        <div>Building tiles loaded/visible: {tileCounts.loaded}/{tileCounts.visible} · Esri imagery/topographic errors: {imageryErrors}/{topographicErrors}</div>
        <button type="button" onClick={() => setRetryKey((key) => key + 1)} className="pointer-events-auto mt-1 rounded border border-cyan-700 px-2 py-1">Reinitialize Cesium</button>
      </div>}
    </div>
  );
}

function withinRwanda(lat: number, lon: number) {
  return lat >= -2.98 && lat <= -0.85 && lon >= 28.8 && lon <= 31.1;
}

function flyToRwanda(viewer: Cesium.Viewer, preset: Props["viewPreset"]) {
  const height = preset === "top" ? 36_000 : preset === "low" ? 18_000 : 30_000;
  const pitch = preset === "top" ? -90 : preset === "low" ? -18 : -38;
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(...KIGALI, height),
    orientation: { heading: Cesium.Math.toRadians(18), pitch: Cesium.Math.toRadians(pitch), roll: 0 },
    duration: 1.1,
  });
}

function flyToCountry(viewer: Cesium.Viewer) {
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(29.9, -1.9, 2_500_000),
    orientation: { heading: 0, pitch: Cesium.Math.toRadians(-90), roll: 0 },
    duration: 1.1,
  });
}

function flyToWorld(viewer: Cesium.Viewer) {
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(0, 0, 18_000_000),
    orientation: { heading: 0, pitch: Cesium.Math.toRadians(-90), roll: 0 },
    duration: 1.1,
  });
}

function distanceMeters(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const radians = Math.PI / 180;
  const dLat = (b.lat - a.lat) * radians;
  const dLon = (b.lon - a.lon) * radians;
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * radians) * Math.cos(b.lat * radians) * Math.sin(dLon / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function coordinateOnPath(
  path: { lat: number; lon: number }[],
  lengths: number[],
  distance: number,
) {
  let segment = 1;
  while (segment < lengths.length - 1 && lengths[segment] < distance) segment += 1;
  const startLength = lengths[segment - 1];
  const segmentLength = lengths[segment] - startLength || 1;
  const t = Math.max(0, Math.min(1, (distance - startLength) / segmentLength));
  return {
    lon: path[segment - 1].lon + (path[segment].lon - path[segment - 1].lon) * t,
    lat: path[segment - 1].lat + (path[segment].lat - path[segment - 1].lat) * t,
  };
}

function addVertexHandles(source: Cesium.CustomDataSource, id: string, coordinates: number[][]) {
  coordinates.forEach(([lon, lat], index) => source.entities.add({
    id: `planning-vertex-${id}-${index}`,
    position: Cesium.Cartesian3.fromDegrees(lon, lat),
    point: { pixelSize: 9, color: Cesium.Color.WHITE, outlineColor: Cesium.Color.CYAN, outlineWidth: 3, heightReference: Cesium.HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Number.POSITIVE_INFINITY },
    properties: { planningVertex: true, planningFeatureId: id, vertexIndex: index },
  }));
}

function isSimplePlanningRing(ring: number[][]): boolean {
  const orient = (a: number[], b: number[], c: number[]) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  for (let i = 0; i < ring.length - 1; i += 1) {
    for (let j = i + 1; j < ring.length - 1; j += 1) {
      if (j === i + 1 || (i === 0 && j === ring.length - 2)) continue;
      const a = ring[i], b = ring[i + 1], c = ring[j], d = ring[j + 1];
      if (orient(a, b, c) * orient(a, b, d) < 0 && orient(c, d, a) * orient(c, d, b) < 0) return false;
    }
  }
  return true;
}

function moveVertex(feature: PlanningFeature, index: number, coordinate: [number, number]): PlanningFeature {
  const geometry = structuredClone(feature.geometry);
  if (geometry.type === "Point") return { ...feature, geometry: { ...geometry, coordinates: coordinate } };
  if (geometry.type === "LineString") {
    const coords = geometry.coordinates as number[][];
    coords[index] = coordinate;
    return { ...feature, geometry: { ...geometry, coordinates: coords } };
  }
  const rings = geometry.coordinates as number[][][];
  const ring = rings[0];
  if (!ring?.length) return feature;
  ring[index] = coordinate;
  if (index === 0) ring[ring.length - 1] = coordinate;
  return { ...feature, geometry: { ...geometry, coordinates: rings } };
}

function translateFeature(feature: PlanningFeature, target: [number, number]): PlanningFeature {
  const coordinates = structuredClone(feature.geometry.coordinates);
  const first = feature.geometry.type === "Point" ? coordinates as number[] : feature.geometry.type === "LineString" ? (coordinates as number[][])[0] : (coordinates as number[][][])[0]?.[0];
  if (!first) return feature;
  const dx = target[0] - first[0];
  const dy = target[1] - first[1];
  const shift = (node: number[] | number[][] | number[][][]) => {
    if (typeof node[0] === "number") {
      (node as number[])[0] += dx;
      (node as number[])[1] += dy;
    } else (node as (number[] | number[][] | number[][][])[]).forEach(shift);
  };
  shift(coordinates as number[] | number[][] | number[][][]);
  return { ...feature, geometry: { ...feature.geometry, coordinates } };
}
