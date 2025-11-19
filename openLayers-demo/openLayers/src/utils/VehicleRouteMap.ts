import OlMap from 'ol/Map'
import View from 'ol/View'
import ImageLayer from 'ol/layer/Image'
import VectorLayer from 'ol/layer/Vector'
import ImageStatic from 'ol/source/ImageStatic'
import VectorSource from 'ol/source/Vector'
import Projection from 'ol/proj/Projection'
import Feature from 'ol/Feature'
import type { FeatureLike } from 'ol/Feature'
import LineString from 'ol/geom/LineString'
import Point from 'ol/geom/Point'
import { Stroke, Style } from 'ol/style'
import Icon from 'ol/style/Icon'
import { getCenter } from 'ol/extent'
import { defaults as defaultControls } from 'ol/control'
import type { Extent } from 'ol/extent'
import type { Coordinate } from 'ol/coordinate'

export interface RoutePoint {
  x: number
  y: number
}

export interface VehicleRouteMapOptions {
  container: HTMLElement
  imageUrl: string
  imageWidth: number
  imageHeight: number
  strokeColor: string
  strokeWidth: number
  path: RoutePoint[]
  padding?: number[]
  arrowSpacing?: number
  startIconUrl?: string
  endIconUrl?: string
  arrowIconUrl?: string
  iconScale?: number
  arrowScale?: number
  onReady?: () => void
}

const DEFAULT_PADDING = [40, 40, 40, 40]
const DEFAULT_START_ICON = '/static/start.png'
const DEFAULT_END_ICON = '/static/end.png'
const DEFAULT_ARROW_ICON = '/static/arrow.png'
const ICON_ANCHOR: [number, number] = [0.5, 0.5]

export class VehicleRouteMap {
  private map?: OlMap
  private vectorSource: VectorSource
  private routeLayer: VectorLayer<VectorSource>
  private extent: Extent
  private projection: Projection
  private imageLayer: ImageLayer<ImageStatic>
  private routeStyle: Style
  private startStyle: Style
  private endStyle: Style
  private arrowIconUrl: string
  private startIconUrl: string
  private endIconUrl: string
  private iconScale: number
  private arrowBaseScale: number
  private arrowScaleFactor: number
  private imageLoaded = false
  private pendingPath: RoutePoint[] = []
  private resizeHandler = () => {
    this.map?.updateSize()
  }

  constructor(private options: VehicleRouteMapOptions) {
    this.extent = [0, 0, options.imageWidth, options.imageHeight]
    this.projection = this.createProjection(options)
    this.iconScale = options.iconScale ?? 1.5
    this.arrowBaseScale = options.arrowScale ?? this.iconScale * 1.2
    this.arrowScaleFactor =
      this.iconScale === 0 ? 1 : this.arrowBaseScale / this.iconScale
    this.startIconUrl = options.startIconUrl ?? DEFAULT_START_ICON
    this.endIconUrl = options.endIconUrl ?? DEFAULT_END_ICON
    this.arrowIconUrl = options.arrowIconUrl ?? DEFAULT_ARROW_ICON

    this.vectorSource = new VectorSource()
    this.routeStyle = this.createRouteStyle(options)
    this.startStyle = this.createIconStyle(this.startIconUrl)
    this.endStyle = this.createIconStyle(this.endIconUrl)
    this.routeLayer = this.createVectorLayer()
    this.imageLayer = this.createImageLayer(options.imageUrl)

    this.pendingPath = options.path
    this.initMap()
    this.bindImageEvents()
  }

  private initMap() {
    const minZoom = this.getMinZoom()
    this.map = new OlMap({
      target: this.options.container,
      layers: [this.imageLayer, this.routeLayer],
      controls: defaultControls({ attribution: false, rotate: false }),
      view: new View({
        projection: this.projection,
        center: getCenter(this.extent),
        zoom: minZoom,
        minZoom,
        maxZoom: minZoom + 8
      })
    })

    this.fitToExtent()
    window.addEventListener('resize', this.resizeHandler)
  }

  private getMinZoom() {
    const container = this.options.container
    const { imageWidth, imageHeight } = this.options
    const containerWidth = container.clientWidth || imageWidth
    const containerHeight = container.clientHeight || imageHeight
    const widthRatio = containerWidth / imageWidth
    const heightRatio = containerHeight / imageHeight
    const ratio = Math.min(widthRatio, heightRatio)
    if (!ratio) return 0
    const minZoom = Math.log2(ratio)
    return Math.min(0, minZoom)
  }

  private fitToExtent() {
    if (!this.map) return
    const padding = this.options.padding || DEFAULT_PADDING
    const size = this.map.getSize()
    if (!size || size[0] === 0 || size[1] === 0) {
      requestAnimationFrame(() => this.fitToExtent())
      return
    }
    this.map.getView().fit(this.extent, {
      size,
      padding
    })
  }

  private normalizePoints(points: RoutePoint[]): Coordinate[] {
    const { imageHeight } = this.options
    return points.map(({ x, y }) => [x, imageHeight - y])
  }

  private drawRoute(points: RoutePoint[]) {
    this.vectorSource.clear()
    if (!points.length) return
    const normalized = this.normalizePoints(points)
    const line = new LineString(normalized)
    const routeFeature = new Feature({
      geometry: line
    })
    routeFeature.set('type', 'route')
    this.vectorSource.addFeature(routeFeature)

    const startFeature = new Feature({
      geometry: new Point(normalized[0])
    })
    startFeature.set('type', 'start')
    this.vectorSource.addFeature(startFeature)

    const endFeature = new Feature({
      geometry: new Point(normalized[normalized.length - 1])
    })
    endFeature.set('type', 'end')
    this.vectorSource.addFeature(endFeature)

    const arrowFeatures = this.createArrowFeatures(line)
    arrowFeatures.forEach((feature) => this.vectorSource.addFeature(feature))
  }

  public updatePath(path: RoutePoint[]) {
    this.pendingPath = path
    if (this.imageLoaded) {
      this.drawRoute(path)
    }
  }

  public destroy() {
    window.removeEventListener('resize', this.resizeHandler)
    if (this.map) {
      this.map.setTarget(undefined)
      this.map = undefined
    }
    this.vectorSource.clear()
  }

  private bindImageEvents() {
    const source = this.imageLayer.getSource()
    if (!source) {
      this.handleImageReady()
      return
    }
    const onLoad = () => {
      this.handleImageReady()
    }
    const onError = () => {
      this.handleImageReady()
    }
    source.once('imageloadend', onLoad)
    source.once('imageloaderror', onError)
  }

  private handleImageReady() {
    this.imageLoaded = true
    if (this.pendingPath.length) {
      this.drawRoute(this.pendingPath)
    }
    this.options.onReady?.()
  }

  private getFeatureStyle(feature: FeatureLike, resolution: number) {
    const type = feature.get('type')
    const scale = this.getScaleForResolution(resolution)
  
    if (type === 'start') {
      const img = this.startStyle.getImage()
      img && img.setScale(scale)
      return this.startStyle
    }
    if (type === 'end') {
      const img = this.endStyle.getImage()
      img && img.setScale(scale)
      return this.endStyle
    }
    if (type === 'arrow') {
      const rotation = feature.get('rotation') || 0
      return this.getArrowStyle(rotation, scale)
    }
    return this.routeStyle
  }

  private getScaleForResolution(resolution: number) {
    const base = this.iconScale
    const s = base / Math.max(resolution, 0.5)
    return Math.min(Math.max(s, base * 0.5), base * 2)
  }

  private getArrowStyle(rotation: number, scale: number) {
    return new Style({
      image: new Icon({
        src: this.arrowIconUrl,
        anchor: [0.5, 0.5],
        anchorXUnits: 'fraction',
        anchorYUnits: 'fraction',
        scale: Math.max(scale * this.arrowScaleFactor, 0.1),
        rotateWithView: true,
        rotation
      })
    })
  }

  private createArrowFeatures(line: LineString) {
    const spacing =
      this.options.arrowSpacing ??
      Math.max(this.options.imageWidth, this.options.imageHeight) / 12
    const totalLength = line.getLength()
    if (!spacing || spacing <= 0 || totalLength === 0) {
      return []
    }
    const features: Feature<Point>[] = []
    for (let dist = spacing; dist < totalLength; dist += spacing) {
      const fraction = dist / totalLength
      const coordinate = line.getCoordinateAt(fraction)
      const rotation = this.getDirectionAngle(line, fraction)
      const feature = new Feature({
        geometry: new Point(coordinate)
      })
      feature.set('type', 'arrow')
      feature.set('rotation', rotation)
      features.push(feature)
    }
    if (!features.length) {
      const coordinate = line.getCoordinateAt(0.5)
      const rotation = this.getDirectionAngle(line, 0.5)
      const feature = new Feature({
        geometry: new Point(coordinate)
      })
      feature.set('type', 'arrow')
      feature.set('rotation', rotation)
      features.push(feature)
    }
    return features
  }

  private getDirectionAngle(line: LineString, fraction: number) {
    const delta = 1e-3
    const start = line.getCoordinateAt(Math.max(0, fraction - delta))
    const end = line.getCoordinateAt(Math.min(1, fraction + delta))
    const dx = end[0] - start[0]
    const dy = end[1] - start[1]
    return Math.atan2(-dy, dx)
  }

  private createProjection(options: VehicleRouteMapOptions) {
    return new Projection({
      code: `static-image-${options.imageWidth}x${options.imageHeight}-${Date.now()}`,
      units: 'pixels',
      extent: this.extent
    })
  }

  private createRouteStyle(options: VehicleRouteMapOptions) {
    return new Style({
      stroke: new Stroke({
        color: options.strokeColor,
        width: options.strokeWidth,
        lineCap: 'round',
        lineJoin: 'round'
      })
    })
  }

  private createIconStyle(src: string) {
    return new Style({
      image: new Icon({
        src,
        anchor: ICON_ANCHOR,
        anchorXUnits: 'fraction',
        anchorYUnits: 'fraction',
        scale: this.iconScale
      })
    })
  }

  private createVectorLayer() {
    return new VectorLayer({
      source: this.vectorSource,
      style: (feature, resolution) => this.getFeatureStyle(feature, resolution)
    })
  }

  private createImageLayer(imageUrl: string) {
    return new ImageLayer({
      source: new ImageStatic({
        url: imageUrl,
        imageExtent: this.extent,
        projection: this.projection
      })
    })
  }
}

