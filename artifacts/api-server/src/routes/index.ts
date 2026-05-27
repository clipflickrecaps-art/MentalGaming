import { Router, type IRouter } from "express";
import healthRouter  from "./health";
import webhookRouter from "./webhook";
import storeRouter   from "./store";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/webhook", webhookRouter);
router.use("/store", storeRouter);

export default router;
