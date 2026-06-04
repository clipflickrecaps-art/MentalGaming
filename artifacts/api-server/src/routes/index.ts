import { Router, type IRouter } from "express";
import healthRouter        from "./health";
import webhookRouter       from "./webhook";
import storeRouter         from "./store";
import gamificationRouter  from "./gamification";
import supportRouter       from "./support";
import adminRouter         from "./admin";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/webhook", webhookRouter);
router.use("/store", storeRouter);
router.use("/store", gamificationRouter);
router.use("/store", supportRouter);
router.use("/store", adminRouter);

export default router;
