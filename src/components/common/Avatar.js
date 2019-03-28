// @flow
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { Avatar } from 'react-native-paper'

export default (props: any) => (
  <View onClick={props.onPress} style={props.onPress ? { ...props.style, ...styles.clickable } : props.style}>
    <Avatar.Image size={34} {...props} style={[styles.avatar, props.style]} />
  </View>
)

const styles = StyleSheet.create({
  avatar: {
    backgroundColor: 'white'
  },
  clickable: {
    cursor: 'pointer'
  }
})
