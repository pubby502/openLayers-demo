import Mock from 'mockjs'
import { reverseForCarData } from './reverseForCar'
import { fetchVehiclePathData } from './fetchVehiclePath'

type MockResponse<T> = {
  code: number
  message: string
  data: T
}

const createSuccessResponse = <T>(data: T): MockResponse<T> => ({
  code: 200,
  message: 'success',
  data
})

Mock.setup({
  timeout: '200-600'
})

Mock.mock(/ReverseForCar/i, 'get', () => createSuccessResponse(reverseForCarData))

Mock.mock(/FecthVehiclePathResponseInfo/i, 'get', () =>
  createSuccessResponse(fetchVehiclePathData)
)

export {}

