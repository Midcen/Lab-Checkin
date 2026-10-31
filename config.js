/* ==========================================================
 * 部署前唯一需要改的文件
 * ========================================================== */

window.LAB_CONFIG = {
  title: "实验室出入登记",

  // Supabase 项目 → Project Settings → API 里复制这两项
  // URL 形如 https://abcdefghijklmn.supabase.co
  supabaseUrl: "https://cofzgotjvravoauzvxcv.supabase.co",
  supabaseAnonKey: "sb_publishable_z9CC4qkpr7fMzFOHGyodOg_fA32csck",

  // 数据表名，建表 SQL 见 supabase.sql
  table: "visits",
  peopleTable: "people",

  // 是否允许在网页右下角的加号里添加新成员（写进数据库，换设备也能看到）
  allowAddPerson: true,

  // 签退时的离开检查清单：只有当这个人走之后实验室里没别人了，才会弹出来
  // 中途出去吃饭、去上课不会打扰；enabled 改成 false 就彻底关掉
  leaveReminder: {
    enabled: true,
    title: "离开前请确认",
    desc: "{person}，实验室里只剩你了，请确认：",
    items: ["关好窗户", "关闭电闸", "锁好门"],
    confirmText: "已确认，签退",
    cancelText: "取消",
  },

  // 初始人员名单。这里的人排在前面；
  // 之后在网页上加的人会追加在后面，并且存在数据库里，不用改这个文件。
  // 名字是记录的主键，改名会让历史记录对不上。
  people: [
    "卢梦实",
    "史家维",
    "周雄珍",
    "李祖扬",
    "王秋阳",
    "王鹏哲",
    "徐楷皓",
    "武筠贺",
    "高一宁",
    "王天泽",
    "任晓燕",
  ],
};
