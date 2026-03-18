/**
 * 响应 CORS 预检（OPTIONS），避免 Worker/静态资源因预检失败无法加载。
 * 由 vercel.json 的 rewrite 将带 access-control-request-method 的请求转到此函数。
 */
module.exports = (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Range");
    res.setHeader("Access-Control-Max-Age", "86400");
    res.status(204).end();
};
