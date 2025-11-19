<template>
  <view class="map-page">
    <div
      ref="mapContainer"
      class="map-container"
      :class="{ 'is-hidden': !mapReady }"
    ></div>
    <view v-if="loading" class="status-banner">地图加载中...</view>
    <view v-else-if="errorMessage" class="status-banner status-error">
      {{ errorMessage }}
    </view>
  </view>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import 'ol/ol.css'
import { VehicleRouteMap, type RoutePoint } from '@/utils/VehicleRouteMap'

type VehiclePathResponse = {
  code: number
  message: string
  data: {
    penColor: string
    penInt: number | string
    fetchVehicledPathResPathMapInfoList: {
      mapFileNameLayout: string
      imgWidth: string
      imgHeight: string
      pathLinePoints: string[]
    }[]
  }
}

const mapContainer = ref<HTMLDivElement | null>(null)
const loading = ref(true)
const errorMessage = ref('')
const mapReady = ref(false)
let mapInstance: VehicleRouteMap | null = null

type ImageAsset = {
  url: string
  cleanup: () => void
}

let currentImageAsset: ImageAsset | null = null

const parsePoint = (point: string): RoutePoint | null => {
  const [x, y] = point
    .split(',')
    .map((value) => Number(value.trim()))
  if (Number.isNaN(x) || Number.isNaN(y)) {
    return null
  }
  return { x, y }
}

const decodeImage = (src: string) =>
  new Promise<void>((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve()
    img.onerror = reject
    img.src = src
  })

const loadImageAsset = async (url: string): Promise<ImageAsset> => {
  try {
    const response = await fetch(url, {
      mode: 'cors',
      cache: 'force-cache'
    })
    if (!response.ok) {
      throw new Error('图片下载失败')
    }
    const blob = await response.blob()
    const objectUrl = URL.createObjectURL(blob)
    await decodeImage(objectUrl)
    return {
      url: objectUrl,
      cleanup: () => URL.revokeObjectURL(objectUrl)
    }
  } catch (error) {
    await decodeImage(url)
    return {
      url,
      cleanup: () => {}
    }
  }
}

const cleanupCurrentAsset = () => {
  currentImageAsset?.cleanup()
  currentImageAsset = null
}

const fetchVehiclePath = () =>
  new Promise<VehiclePathResponse>((resolve, reject) => {
    uni.request({
      url: '/FecthVehiclePathResponseInfo',
      method: 'GET',
      success: (res) => {
        resolve(res.data as VehiclePathResponse)
      },
      fail: reject
    })
  })

const initMap = async () => {
  if (!mapContainer.value) return
  try {
    loading.value = true
    mapReady.value = false
    errorMessage.value = ''
    const response = await fetchVehiclePath()
    const payload = response.data
    const mapInfo = payload.fetchVehicledPathResPathMapInfoList?.[0]
    if (!mapInfo) {
      errorMessage.value = '未获取到地图信息'
      loading.value = false
      return
    }

    const imageWidth = Number(mapInfo.imgWidth)
    const imageHeight = Number(mapInfo.imgHeight)
    const pathPoints =
      mapInfo.pathLinePoints
        ?.map(parsePoint)
        .filter((point): point is RoutePoint => Boolean(point)) ?? []

    if (!pathPoints.length) {
      errorMessage.value = '路径数据为空'
      loading.value = false
      return
    }

    cleanupCurrentAsset()
    currentImageAsset = await loadImageAsset(mapInfo.mapFileNameLayout)

    mapInstance?.destroy()
    mapInstance = new VehicleRouteMap({
      container: mapContainer.value,
      imageUrl: currentImageAsset.url,
      imageWidth,
      imageHeight,
      strokeColor: payload.penColor || '#ff0000',
      strokeWidth: Number(payload.penInt) || 6,
      path: pathPoints,
      arrowSpacing: 1100,
      iconScale: 0.4,
      arrowScale: 0.8,
      onReady: () => {
        loading.value = false
        mapReady.value = true
      }
    })
  } catch (error) {
    console.error(error)
    errorMessage.value = '地图数据请求失败'
    loading.value = false
  }
}

onMounted(() => {
  initMap()
})

onBeforeUnmount(() => {
  mapInstance?.destroy()
  mapInstance = null
  cleanupCurrentAsset()
})
</script>

<style scoped>
.map-page {
  position: relative;
  width: 100vw;
  height: 100vh;
  background-color: #f5f5f5;
}

.map-container {
  width: 100%;
  height: 100%;
  overflow: hidden;
  transition: opacity 0.25s ease;
}

.map-container.is-hidden {
  opacity: 0;
  pointer-events: none;
}

.status-banner {
  position: absolute;
  left: 50%;
  top: 16px;
  transform: translateX(-50%);
  background-color: rgba(0, 0, 0, 0.6);
  color: #fff;
  padding: 8px 16px;
  border-radius: 16px;
  font-size: 14px;
  z-index: 2;
  pointer-events: none;
}

.status-error {
  background-color: rgba(220, 53, 69, 0.85);
}
</style>
