/** skinview3d 模型里的部件键名 */
export const ALL_BODY_KEYS = ['head', 'body', 'rightArm', 'leftArm', 'rightLeg', 'leftLeg'] as const
export type BodyKey = (typeof ALL_BODY_KEYS)[number]

/**
 * 单部件的中文名。
 * 左右以「角色自身」为准（角色面向镜头时，他的左手出现在画面右侧），与皮肤 UV 的命名一致。
 */
export const BODY_KEY_LABELS: Record<BodyKey, string> = {
  head: '头部',
  body: '身体',
  rightArm: '右臂',
  leftArm: '左臂',
  rightLeg: '右腿',
  leftLeg: '左腿',
}
