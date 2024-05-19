/**
 * Copyright 2023 Antrea Authors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import HeatMap from "react-heatmap-grid";
import { useState, useEffect} from 'react';
import { CdsCard } from '@cds/react/card';
import { CdsDivider } from '@cds/react/divider';
import { AgentInfo, ControllerInfo, Condition, K8sRef, agentInfoAPI, controllerInfoAPI, NodeIPLatencyStatsInfo, NodeIPLatencyStatsInfoList, NodeIPLatencyEntry, nodeIPLatencyStatsInfoAPI } from '../api/info';
import { FeatureGate, featureGatesAPI } from '../api/featuregates';
import { useAppError} from '../components/errors';
import { WaitForAPIResource } from '../components/progress';

type Property = string

const controllerProperties: Property[] = ['Name', 'Version', 'Pod Name', 'Node Name', 'Connected Agents', 'Healthy', 'Last Heartbeat'];
const agentProperties: Property[] = ['Name', 'Version', 'Pod Name', 'Node Name', 'Local Pods', 'Node Subnets', 'OVS Version', 'Healthy', 'Last Heartbeat'];
const featureGateProperties: Property[] = ['Name', 'Status', 'Version'];

function refToString(ref: K8sRef | undefined): string {
    if (!ref) return 'Unknown';
    if (ref.namespace) return ref.namespace + '/' + ref.name;
    return ref.name;
}

// returns status and last heartbeat time
function getConditionInfo(conditions: Condition[] | undefined, name: string): [string, string] {
    if (!conditions) return ['False', 'None'];
    const condition = conditions.find(c => c.type === name);
    if (!condition) return ['False', 'None'];
    return [condition.status, new Date(condition.lastHeartbeatTime).toLocaleString()];
}

function controllerPropertyValues(controller: ControllerInfo): string[] {
    const [healthy, lastHeartbeat] = getConditionInfo(controller.controllerConditions, 'ControllerHealthy');
    return [
        controller.metadata.name,
        controller?.version ?? 'Unknown',
        refToString(controller.podRef),
        refToString(controller.nodeRef),
        (controller.connectedAgentNum??0).toString(),
        healthy,
        lastHeartbeat,
    ];
}

function featureGatePropertyValues(featureGate: FeatureGate): string[] {
    return [featureGate.name, featureGate.status, featureGate.version];
}

function agentPropertyValues(agent: AgentInfo): string[] {
    const [healthy, lastHeartbeat] = getConditionInfo(agent.agentConditions, 'AgentHealthy');
    return [
        agent.metadata.name,
        agent?.version ?? 'Unknown',
        refToString(agent.podRef),
        refToString(agent.nodeRef),
        (agent.localPodNum??0).toString(),
        agent.nodeSubnets?.join(',') ?? 'None',
        agent?.ovsInfo?.version ?? 'Unknown',
        healthy,
        lastHeartbeat,
    ];
}

function CustomHeatMap<T>(props: {title: string, xLabels: string[], yLabels: string[], data: T[]}) {
    const { title, xLabels, yLabels, data } = props;
    return (
        <CdsCard title={title}>
            <div cds-layout="gap:md">
                <div cds-text="section" cds-layout="p-y:sm">
                    {props.title}
                </div>
                <CdsDivider cds-card-remove-margin></CdsDivider>

                <div style={{ backgroundColor: "rgb(128 142 255)", paddind: "10px", margin: "10px"}}>
                <HeatMap
                    xLabels={xLabels}
                    xLabelsLocation={"bottom"}
                    yLabels={yLabels}
                    data={data}
                    cellStyle={(background, value, min, max, data, x, y) => ({
                        background: `rgb(0, 151, 230, ${1 - (max - value) / (max - min)})`,
                        fontSize: "11.5px",
                        color: "#444"
                    })}
                    title={(value, unit) => `${value}`}
                    cellRender={value => value && <div cds-text="center body" cds-layout="">{value/1000}ms</div>}
                    height={80} />
                </div>
            </div>
        </CdsCard>
    );
}

function ComponentSummary<T>(props: {title: string, data: T[], propertyNames: Property[], getProperties: (x: T) => string[]}) {
    const propertyNames = props.propertyNames;
    const data = props.data;

    return (
        <CdsCard title={props.title}>
            <div cds-layout="vertical gap:md">
                <div cds-text="section" cds-layout="p-y:sm">
                    {props.title}
                </div>
                <CdsDivider cds-card-remove-margin></CdsDivider>
                <table cds-table="border:all" cds-text="center body">
                    <thead>
                        <tr>
                            {
                                propertyNames.map(name => (
                                    <th key={name}>{name}</th>
                                ))
                            }
                        </tr>
                    </thead>
                    <tbody>
                        {
                            data.map((x: T, idx: number) => {
                                const values = props.getProperties(x);
                                return (
                                    <tr key={idx}>
                                        {
                                            values.map((v: string, idx: number) => (
                                                <td key={idx}>{v}</td>
                                            ))
                                        }
                                    </tr>
                                );
                            })
                        }
                    </tbody>
                </table>
            </div>
        </CdsCard>
    );
}

export default function Summary() {
    const [controllerInfo, setControllerInfo] = useState<ControllerInfo>();
    const [agentInfos, setAgentInfos] = useState<AgentInfo[]>();
    const [controllerFeatureGates, setControllerFeatureGates] = useState<FeatureGate[]>();
    const [agentFeatureGates, setAgentFeatureGates] = useState<FeatureGate[]>();
    const [nodeIPLatencyStats, setNodeIPLatencyStats] = useState<NodeIPLatencyStatsInfoList>();
    const [xLabels, setXLabels] = useState<string[]>([]);
    const [yLabels, setYLabels] = useState<string[]>([]);
    const [data, setData] = useState<number[][]>([]);
    const { addError, removeError } = useAppError();

    useEffect(() => {
        async function getControllerInfo() {
            try {
                const controllerInfo = await controllerInfoAPI.fetch();
                return controllerInfo;
            } catch (e) {
                if (e instanceof Error ) addError(e);
                console.error(e);
            }
        }

        async function getNodeIPLatencyStatsInfo() {
            try {
                const nodeIPLatencyStatsInfo = await nodeIPLatencyStatsInfoAPI.fetch();
                return nodeIPLatencyStatsInfo;
            } catch (e) {
                if (e instanceof Error ) addError(e);
                console.error(e);
            }
        }

        async function getAgentInfos() {
            try {
                const agentInfos = await agentInfoAPI.fetchAll();
                return agentInfos;
            } catch (e) {
                if (e instanceof Error ) addError(e);
                console.error(e);
            }
        }

        async function getFeatureGates() {
            try {
                const featureGates = await featureGatesAPI.fetch();
                return featureGates;
            } catch (e) {
                if (e instanceof Error ) addError(e);
                console.error(e);
            }
        }

        // Defining this functions inside of useEffect is recommended
        // https://reactjs.org/docs/hooks-faq.html#is-it-safe-to-omit-functions-from-the-list-of-dependencies
        async function getData() {
            const [controllerInfo, agentInfos, featureGates, nodeIPLatencyStatsInfoList] = await Promise.all([getControllerInfo(), getAgentInfos(), getFeatureGates(), getNodeIPLatencyStatsInfo()]);
            setControllerInfo(controllerInfo);
            setAgentInfos(agentInfos);
            setNodeIPLatencyStats(nodeIPLatencyStatsInfoList);

            if (featureGates !== undefined) {
                setControllerFeatureGates(featureGates.filter((fg) => fg.component === 'controller'));
                setAgentFeatureGates(featureGates.filter((fg) => fg.component === 'agent'));
            }

            if (nodeIPLatencyStatsInfoList !== undefined) {
                const nodeIPLatencyStats: NodeIPLatencyStatsInfo[] = nodeIPLatencyStatsInfoList.Items;
                const xLabels: string[] = [];
                const data: number[][] = [];
                // Init xLabels with empty string to make sure the first row is empty
                nodeIPLatencyStats.forEach((nodeIPLatencyStatsInfo: NodeIPLatencyStatsInfo) => {
                    xLabels.push(nodeIPLatencyStatsInfo.name);
                });
                // Init yLabels with empty string to make sure the first column is empty
                const yLabels: string[] = xLabels;
                nodeIPLatencyStats.forEach((nodeIPLatencyStatsInfo: NodeIPLatencyStatsInfo) => {
                    const nodeIPLatencyEntries: NodeIPLatencyEntry[] = nodeIPLatencyStatsInfo.NodeIPLatencyList;
                    const nodeIPLatency: number[] = [];
                    const nodeIPLatencyMap: Map<string, number> = new Map();
                    nodeIPLatencyEntries.forEach((nodeIPLatencyEntry: NodeIPLatencyEntry) => {
                        console.log(nodeIPLatencyEntry.NodeName, nodeIPLatencyEntry.LastMeasuredRTT);
                        nodeIPLatencyMap.set(nodeIPLatencyEntry.NodeName, nodeIPLatencyEntry.LastMeasuredRTT);
                    });


                    for (let i = 0; i < yLabels.length; i++) {
                        const nodeName = xLabels[i];
                        nodeIPLatency.push(nodeIPLatencyMap.get(nodeName) ?? 0);
                    }
                    data.push(nodeIPLatency);
                });
                setXLabels(xLabels);
                setYLabels(yLabels);
                setData(data);
                console.log(data);
            }

            if (nodeIPLatencyStatsInfoList != undefined && controllerInfo !== undefined && agentInfos !== undefined && featureGates !== undefined) {
                removeError();
            }
        }

        getData();
    }, [addError, removeError]);

    return (
        <main>
            <div cds-layout="vertical gap:lg">
                <p cds-text="title">Summary</p>
                <WaitForAPIResource ready={controllerInfo !== undefined} text="Loading Controller Information">
                    <ComponentSummary title="Controller" data={new Array(controllerInfo!)} propertyNames={controllerProperties} getProperties={controllerPropertyValues} />
                </WaitForAPIResource>
                <WaitForAPIResource ready={agentInfos !== undefined} text="Loading Agents Information">
                    <ComponentSummary title="Agents" data={agentInfos!} propertyNames={agentProperties} getProperties={agentPropertyValues} />
                </WaitForAPIResource>
                <WaitForAPIResource ready={nodeIPLatencyStats !== undefined} text="Loading NodeIPLatency Information">
                    <CustomHeatMap title="NodeLatency" xLabels={xLabels} yLabels={yLabels} data={data} />
                </WaitForAPIResource>
                <WaitForAPIResource ready={controllerFeatureGates !== undefined} text="Loading Controller Feature Gates">
                    <ComponentSummary title="Controller Feature Gates" data={controllerFeatureGates} propertyNames={featureGateProperties} getProperties={featureGatePropertyValues} />
                </WaitForAPIResource>
                <WaitForAPIResource ready={agentFeatureGates !== undefined} text="Loading Agent Feature Gates">
                    <ComponentSummary title="Agent Feature Gates" data={agentFeatureGates!} propertyNames={featureGateProperties} getProperties={featureGatePropertyValues} />
                </WaitForAPIResource>

            </div>
        </main>
    );
}
