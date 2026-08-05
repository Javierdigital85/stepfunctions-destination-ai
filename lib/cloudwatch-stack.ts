import { Stack, StackProps, Duration } from "aws-cdk-lib";
import { Dashboard, GraphWidget, Metric } from "aws-cdk-lib/aws-cloudwatch";
import { Construct } from "constructs";

interface CloudWatchStackProps extends StackProps {
  destinationAiWorkflowArn: string;
  confirmDestinationWorkflowArn: string;
}

export class CloudWatchStack extends Stack {
  constructor(scope: Construct, id: string, props: CloudWatchStackProps) {
    super(scope, id, props);
    const dashboard = new Dashboard(this, "DemoStepFunctionsDashboard", {
      dashboardName: "DemoStepFunctionsDashboard",
    });

    dashboard.addWidgets(
      // ExecutionsStarted - Monitorear actividad
      new GraphWidget({
        title: "Demo Step Functions - Executions Started",
        width: 12,
        left: [
          new Metric({
            namespace: "AWS/States",
            metricName: "ExecutionsStarted",
            dimensionsMap: {
              StateMachineArn: props.destinationAiWorkflowArn,
            },
            statistic: "sum",
            label: "Destination AI Autocomplete",
            period: Duration.minutes(1),
          }),

          new Metric({
            namespace: "AWS/States",
            metricName: "ExecutionsStarted",
            dimensionsMap: {
              StateMachineArn: props.confirmDestinationWorkflowArn,
            },
            statistic: "sum",
            label: "Confirm Destination",
            period: Duration.minutes(1),
          }),
        ],
      }),
      // ExecutionsSucceeded - Ejecuciones exitosas
      new GraphWidget({
        title: "Demo Step Functions - Executions Succeeded",
        width: 12,
        left: [
          new Metric({
            namespace: "AWS/States",
            metricName: "ExecutionsSucceeded",
            dimensionsMap: {
              StateMachineArn: props.destinationAiWorkflowArn,
            },
            statistic: "sum",
            label: "Destination AI Success",
            period: Duration.minutes(1),
          }),
          new Metric({
            namespace: "AWS/States",
            metricName: "ExecutionsSucceeded",
            dimensionsMap: {
              StateMachineArn: props.confirmDestinationWorkflowArn,
            },
            statistic: "sum",
            label: "Confirm Destination Success",
            period: Duration.minutes(1),
          }),
        ],
      }),

      // ExecutionsFailed - Detectar fallos
      new GraphWidget({
        title: "Demo Step Functions - Executions Failed",
        width: 12,
        left: [
          new Metric({
            namespace: "AWS/States",
            metricName: "ExecutionsFailed",
            dimensionsMap: {
              StateMachineArn: props.destinationAiWorkflowArn,
            },
            statistic: "sum",
            label: "Destination AI Failed",
            period: Duration.minutes(1),
          }),
          new Metric({
            namespace: "AWS/States",
            metricName: "ExecutionsFailed",
            dimensionsMap: {
              StateMachineArn: props.confirmDestinationWorkflowArn,
            },
            statistic: "sum",
            label: "Confirm Destination Failed",
            period: Duration.minutes(1),
          }),
        ],
      }),
    );
  }
}
