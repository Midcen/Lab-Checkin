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

  // 人员名单，页面上按这个顺序生成头像按钮
  // 改名后重新推一次 gh-pages 即可，历史记录按名字匹配，改名会断开
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
