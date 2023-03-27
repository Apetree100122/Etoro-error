import { useCallback, useEffect, useRef } from 'react'
import { Notifications } from 'react-native-notifications'
// eslint-disable-next-line import/default
import PushNotification from 'react-native-push-notification'

import { invokeMap, noop } from 'lodash'
import { EventEmitter } from 'eventemitter3'
import { Platform } from 'react-native'
import Config from '../../../config/config'
import { NotificationsAPI } from '../api/NotificationsApi'
import { CHANNEL_ID, NotificationsCategories } from '../constants'
import { useLocalProperty } from '../../wallet/GoodWalletProvider'
import logger from '../../logger/js-logger'
import { getCategory, useNotificationsStateSwitch } from './useNotifications.common'

const log = logger.child({ from: 'useNotifications (native)' })

const { notificationTime: defaultNotificationTime, notificationSchedule } = Config
let bridge = null

const NOTIFICATION = {
  title: "It's that time of the day 💸 💙",
  message: 'Claim your free GoodDollars now. It takes 10 seconds.',
}

const initializeNotificationsAndroid = () => {
  const onNotification = ({ data: payload, ...rest }) => bridge.emit('opened', { ...rest, payload })

  bridge = new EventEmitter()

  PushNotification.configure({
    requestPermissions: false,
    popInitialNotification: false,
    onNotification,
  })
  log.debug('initialized notifications')
}

export { useNotificationsSupport } from './useNotifications.common'

export const useClaimNotificationOptions = options => {
  const [scheduleId, setScheduleId] = useLocalProperty('notificationsScheduleId')
  const updateClaimNotification = useCallback(
    (value, notificationTime = defaultNotificationTime) => {
      let newScheduleId = null

      log.debug('setting claim notification:', { scheduleId, value })
      if (scheduleId) {
        PushNotification.cancelLocalNotification(scheduleId)
      }

      if (value === true) {
        newScheduleId = Math.floor(Math.random() * Math.pow(2, 32))
        PushNotification.localNotificationSchedule({
          ...NOTIFICATION,
          id: newScheduleId,
          channelId: CHANNEL_ID,
          date: notificationTime,
          repeatType: notificationSchedule,
          allowWhileIdle: true,
          userInfo: {
            category: NotificationsCategories.CLAIM_NOTIFICATION,
            ...NOTIFICATION,
          },
        })
      }
      log.debug('new claim notification create:', {
        scheduleId,
        value,
        newScheduleId,
        notificationTime,
        notificationSchedule,
      })

      setScheduleId(newScheduleId)
    },
    [scheduleId, setScheduleId],
  )

  const switchState = useNotificationsStateSwitch(scheduleId, updateClaimNotification, options)

  useEffect(() => {
    PushNotification.createChannel({
      channelId: CHANNEL_ID,
      channelName: 'GoodDollar claim notifications',
    })
  }, [])

  return { ...switchState, updateClaimNotification }
}

export const useNotifications = (onOpened = noop, onReceived = noop) => {
  const { enabled } = useClaimNotificationOptions()
  const mountedRef = useRef(false)

  const receivedHandler = useCallback(
    (notification, completion = noop) => {
      onReceived(notification, getCategory(notification))

      // should call completion otherwise notifications won't receive in background
      completion({ alert: true, sound: true, badge: false })
    },
    [onReceived],
  )

  const openedHandler = useCallback(
    (notification, completion = noop) => {
      onOpened(notification, getCategory(notification))
      completion()
    },
    [onOpened],
  )

  useEffect(() => {
    if (!enabled || mountedRef.current) {
      return
    }

    mountedRef.current = true

    NotificationsAPI.getInitialNotification()
      .catch(noop)
      .then(notification => {
        if (!notification) {
          return
        }

        receivedHandler(notification)
        openedHandler(notification)
      })
  }, [enabled, openedHandler, receivedHandler])

  useEffect(() => {
    if (!enabled) {
      return
    }

    const events = Notifications.events()

    const subscriptions = [
      events.registerNotificationReceivedForeground(receivedHandler),
      events.registerNotificationReceivedBackground(receivedHandler),
      events.registerNotificationOpened(openedHandler),
    ]

    if (bridge) {
      bridge.on('opened', openedHandler)
    }

    return () => {
      if (bridge) {
        bridge.off('opened', openedHandler)
      }

      invokeMap(subscriptions, 'remove')
    }
  }, [enabled, receivedHandler, openedHandler])
}

Platform.select({
  android: initializeNotificationsAndroid,
  default: noop,
})()
