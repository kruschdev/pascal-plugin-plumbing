import { describe, expect, test } from 'bun:test'
import {
  calculateSupplyHydraulics,
  checkDryerVentRun,
  checkTrapArmDistance,
  sizeBuildingDrain,
  sizeDrainBranch,
  sizeFuelGasPipe,
  sizeSupplyPipe,
  sizeVentStack,
  sizeWaterHeater,
  wsfuToGpm,
} from '../ipc/sizing'

describe('IPC / UPC / IFGC / IRC Sizing Engine', () => {
  test('sizeDrainBranch enforces >= 3" once a water closet is upstream and 4" for 3+ WCs', () => {
    const lav = sizeDrainBranch({ dfu: 2 })
    expect(lav.recommendedSize).toBe('1-1/2"')
    expect(lav.minSlopeInPerFt).toBe(0.25)

    const oneWc = sizeDrainBranch({ dfu: 6, hasWaterCloset: true, waterClosetCount: 1 })
    expect(oneWc.recommendedSize).toBe('3"')
    expect(oneWc.minSlopeInPerFt).toBe(0.125)

    const threeWc = sizeDrainBranch({ dfu: 15, hasWaterCloset: true, waterClosetCount: 3 })
    expect(threeWc.recommendedSize).toBe('4"')
  })

  test('sizeBuildingDrain selects 3" for typical 28 DFU residential and 4" for 60 DFU commercial', () => {
    const res = sizeBuildingDrain({ totalDfu: 28, slopeInPerFt: 0.25, waterClosetCount: 2 })
    expect(res.recommendedSize).toBe('3"')

    const comm = sizeBuildingDrain({ totalDfu: 60, slopeInPerFt: 0.25, waterClosetCount: 4 })
    expect(comm.recommendedSize).toBe('4"')
  })

  test('sizeVentStack enforces 3" residential main stack per IPC 903.1', () => {
    expect(sizeVentStack({ totalDfu: 24, isMainStack: true }).recommendedSize).toBe('3"')
    expect(sizeVentStack({ totalDfu: 6, isMainStack: false }).recommendedSize).toBe('1-1/2"')
  })

  test('checkTrapArmDistance enforces IPC Table 909.1 limits', () => {
    expect(checkTrapArmDistance('1-1/2"', 5.5).ok).toBe(true)
    expect(checkTrapArmDistance('1-1/2"', 7.5).ok).toBe(false)
    expect(checkTrapArmDistance('2"', 8.0).ok).toBe(true)
    expect(checkTrapArmDistance('3"', 11.5).ok).toBe(true)
  })

  test('wsfuToGpm interpolates Hunter curve and sizeSupplyPipe respects hot copper 5 ft/s velocity cap', () => {
    const gpm = wsfuToGpm(20, 'flush-tank')
    expect(gpm).toBeCloseTo(19.6, 1)

    const hotCopper = calculateSupplyHydraulics({
      gpm: 12,
      size: '1/2"',
      material: 'copper-l',
      isHot: true,
    })
    expect(hotCopper.velocityOk).toBe(false)
    expect(hotCopper.maxVelocityFps).toBe(5)

    const sized = sizeSupplyPipe({ wsfu: 20, material: 'copper-l', isHot: true })
    expect(sized.velocityOk).toBe(true)
    expect(['1"', '1-1/4"']).toContain(sized.size)
  })

  test('sizeWaterHeater recommends 50/75 gal tank, expansion tank, and electrical/gas loads', () => {
    const elec = sizeWaterHeater({ bathrooms: 2, bedrooms: 3, fuelType: 'electric' })
    expect(elec.recommendedTankGal).toBe(50)
    expect(elec.expansionTankGal).toBe(2)
    expect(elec.electricalBreakerAmps).toBe(30)
    expect(elec.electricalLoadWatts).toBe(4500)

    const tankless = sizeWaterHeater({ bathrooms: 3, bedrooms: 4, fuelType: 'tankless-gas' })
    expect(tankless.gasBtuh).toBeGreaterThanOrEqual(180000)
  })

  test('sizeFuelGasPipe follows IFGC Table 402.4 longest-length capacities', () => {
    const res = sizeFuelGasPipe({ totalBtuh: 120000, longestRunFt: 50, material: 'black-iron' })
    expect(res.ok).toBe(true)
    expect(res.recommendedSize).toBe('3/4"')

    const csst = sizeFuelGasPipe({ totalBtuh: 200000, longestRunFt: 60, material: 'csst' })
    expect(csst.ok).toBe(true)
    expect(csst.recommendedSize).toBe('1"')
  })

  test('checkDryerVentRun enforces IRC M1502.4 35 ft effective length with elbow deductions', () => {
    expect(checkDryerVentRun({ lengthFt: 20, elbows90: 2 }).ok).toBe(true)
    expect(checkDryerVentRun({ lengthFt: 28, elbows90: 2 }).ok).toBe(false)
  })
})
