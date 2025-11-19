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
  startIconUrl?: string
  endIconUrl?: string
  iconScale?: number
  ownerIconUrl?: string
  ownerDuration?: number
  onReady?: () => void
}

const DEFAULT_PADDING = [40, 40, 40, 40]
const DEFAULT_START_ICON = '/static/start.png'
const DEFAULT_END_ICON = '/static/end.png'
const DEFAULT_OWNER_ICON = '/static/owner.png'
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
  private startIconUrl: string
  private endIconUrl: string
  private iconScale: number
  private ownerIconUrl: string
  private ownerStyle: Style
  private ownerDuration: number
  private ownerFeature?: Feature<Point>
  private animationFrameId?: number
  private imageLoaded = false
  private pendingPath: RoutePoint[] = []
  private resizeHandler = () => {
    this.map?.updateSize()
  }

  constructor(private options: VehicleRouteMapOptions) {
    this.extent = [0, 0, options.imageWidth, options.imageHeight]
    this.projection = this.createProjection(options)
    this.iconScale = options.iconScale ?? 1.5
    this.ownerDuration = options.ownerDuration ?? 6000
    this.startIconUrl = options.startIconUrl ?? DEFAULT_START_ICON
    this.endIconUrl = options.endIconUrl ?? DEFAULT_END_ICON
    this.ownerIconUrl = options.ownerIconUrl ?? DEFAULT_OWNER_ICON

    this.vectorSource = new VectorSource()
    this.routeStyle = this.createRouteStyle(options)
    this.startStyle = this.createIconStyle(this.startIconUrl)
    this.endStyle = this.createIconStyle(this.endIconUrl)
    this.ownerStyle = this.createIconStyle(this.ownerIconUrl, this.iconScale * 1.1)
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

    this.initOwnerFeature(normalized[0])
    this.animateOwnerAlongPath(line)
  }

  public updatePath(path: RoutePoint[]) {
    this.pendingPath = path
    if (this.imageLoaded) {
      this.drawRoute(path)
    }
  }

  public destroy() {
    window.removeEventListener('resize', this.resizeHandler)
    this.cancelOwnerAnimation()
    if (this.map) {
      this.map.setTarget(undefined)
      this.map = undefined
    }
    this.vectorSource.clear()
    this.ownerFeature = undefined
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
    return this.routeStyle
  }

  private getScaleForResolution(resolution: number) {
    const base = this.iconScale
    const s = base / Math.max(resolution, 0.5)
    return Math.min(Math.max(s, base * 0.5), base * 2)
  }

  private initOwnerFeature(startCoordinate: Coordinate) {
    if (!this.ownerFeature) {
      this.ownerFeature = new Feature({
        geometry: new Point(startCoordinate)
      })
      this.ownerFeature.setStyle(this.ownerStyle)
      this.vectorSource.addFeature(this.ownerFeature)
    } else {
      this.ownerFeature.getGeometry()?.setCoordinates(startCoordinate)
    }
  }

  private animateOwnerAlongPath(line: LineString) {
    if (!this.ownerFeature) return
    this.cancelOwnerAnimation()
    const duration = Math.max(this.ownerDuration, 1000)

    const run = () => {
      const startTime = this.getNow()
      const step = (time: number) => {
        const elapsed = time - startTime
        let fraction = elapsed / duration
        if (fraction >= 1) {
          fraction = 1
        }
        const coordinate = line.getCoordinateAt(fraction)
        this.ownerFeature?.getGeometry()?.setCoordinates(coordinate)
        if (fraction < 1) {
          this.animationFrameId = requestAnimationFrame(step)
        } else {
          this.animationFrameId = requestAnimationFrame(run)
        }
      }
      this.animationFrameId = requestAnimationFrame(step)
    }

    run()
  }

  private cancelOwnerAnimation() {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId)
      this.animationFrameId = undefined
    }
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

  private createIconStyle(src: string, scale = this.iconScale) {
    return new Style({
      image: new Icon({
        src,
        anchor: ICON_ANCHOR,
        anchorXUnits: 'fraction',
        anchorYUnits: 'fraction',
        scale
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

  private getNow() {
    if (typeof performance !== 'undefined' && performance.now) {
      return performance.now()
    }
    return Date.now()
  }
}

