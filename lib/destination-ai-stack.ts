import {
  CfnOutput,
  RemovalPolicy,
  SecretValue,
  Stack,
  StackProps,
} from "aws-cdk-lib";
import { Authorization, Connection } from "aws-cdk-lib/aws-events";
import {
  PolicyDocument,
  PolicyStatement,
  Role,
  ServicePrincipal,
} from "aws-cdk-lib/aws-iam";
import { Bucket } from "aws-cdk-lib/aws-s3";
import { BucketDeployment, Source } from "aws-cdk-lib/aws-s3-deployment";
import {
  DefinitionBody,
  LogLevel,
  StateMachine,
  StateMachineType,
} from "aws-cdk-lib/aws-stepfunctions";
import { Construct } from "constructs";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import { Subscription, SubscriptionProtocol, Topic } from "aws-cdk-lib/aws-sns";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";

interface DestinationAiProps extends StackProps {
  readonly destinationEmailNotification?: string;
}

export class DestinationAiStack extends Stack {
  //agregue esto para poner las metricas
  public readonly confirmDestinationWorkflowArn: CfnOutput;
  public readonly destinationAiWorkflowArn: CfnOutput;

  constructor(scope: Construct, id: string, props?: DestinationAiProps) {
    super(scope, id, props);

    // Creamos el bucket
    const dataBucket = new Bucket(this, "StateMachineAIDestination", {
      bucketName: "demo-statemachine-ai-destination-data-bucket",
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      enforceSSL: true,
    });

    // Topic de SNS para notificar nuevos destinos
    const newDestinationTopic = new Topic(this, "NewDestinationTopic", {
      topicName: "demo-travel-world-new-destination",
    });

    const notificationEmail = props?.destinationEmailNotification;
    if (!notificationEmail) {
      throw new Error("DESTINATION_NOTIFICATION_EMAIL env is required");
    }

    new Subscription(this, "NewDestinationTopicSubscription", {
      topic: newDestinationTopic,
      endpoint: notificationEmail,
      protocol: SubscriptionProtocol.EMAIL,
    });

    // creamos una politica de acceso y esto lo hacemos para todos los recursos que la maquina de estado va a llamar
    // Esto es una politica de IAM
    const policyS3Access = new PolicyDocument({
      statements: [
        new PolicyStatement({
          actions: ["s3:GetObject", "s3:PutObject", "s3:ListBucket"], // Nos permite hacer un GetObject en S3 y PutObject para poner un archivo en este bucket
          resources: [dataBucket.bucketArn, `${dataBucket.bucketArn}/*`], //En el data bucket que creamos
        }),
      ],
    });

    // Deploy prompts to s3
    // Subir los prompts automáticamente a S3
    new BucketDeployment(this, "DeployPrompts", {
      sources: [Source.asset("./demo-data")],
      destinationBucket: dataBucket,
      destinationKeyPrefix: "prompts/",
    });

    //creamos la conexion a una API externa
    const openaiAPIConnection = new Connection(
      this,
      "StateMachineAIDestinationOpenAi",
      {
        connectionName: "demo-openai",
        description: "Connection for HTTP API calls",
        authorization: Authorization.apiKey(
          "Authorization",
          SecretValue.secretsManager("openai-api-key"),
        ),
      },
    );

    //Le damos permiso a la maquina de estado para obtener esta informacion
    const connectionAccessPolicy = new PolicyDocument({
      statements: [
        new PolicyStatement({
          actions: ["events:RetrieveConnectionCredentials"],
          resources: [openaiAPIConnection.connectionArn],
        }),
        new PolicyStatement({
          actions: [
            "secretsmanager:GetSecretValue",
            "secretsmanager:DescribeSecret",
          ],
          resources: [
            `arn:aws:secretsmanager:${this.region}:${this.account}:secret:events!connection/*`,
          ],
        }),
      ],
    });

    // Le damos permiso a nuestra maquina de estado para que pueda hacer invocaciones HTTP
    const policyHttpEndpoint = new PolicyDocument({
      statements: [
        new PolicyStatement({
          actions: ["states:InvokeHTTPEndpoint"],
          resources: ["*"],
        }),
      ],
    });

    // Permiso de Bedrock
    const policyInvokeBedrock = new PolicyDocument({
      statements: [
        new PolicyStatement({
          actions: ["bedrock:InvokeModel"],
          resources: [
            `arn:aws:bedrock:*::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0`,
            `arn:aws:bedrock:${this.region}:${this.account}:inference-profile/global.anthropic.claude-haiku-4-5-20251001-v1:0`,
          ],
        }),
      ],
    });

    // Permiso de SNS
    const policySnsPublish = new PolicyDocument({
      statements: [
        new PolicyStatement({
          actions: ["sns:Publish"],
          resources: [newDestinationTopic.topicArn],
        }),
      ],
    });

    // Creamos el role, lo que nuestra maquina de estado va a necesitar para poder obtener los permisos e invocando los diferentes servicios
    const stateMachineRole = new Role(this, "DestinationAiRole", {
      assumedBy: new ServicePrincipal("states.amazonaws.com"),
      inlinePolicies: {
        S3AccessPolicy: policyS3Access, //Le pasamos la politica a medida que agregamos mas recursos,esta maquina de estado ahora podra obtener el objeto
        connectionAccessPolicy: connectionAccessPolicy, //permiso para la conexion
        policyHttpEndpoint: policyHttpEndpoint, //permiso para hacer llamadas http
        policyInvokeBedrock: policyInvokeBedrock,
        policySnsPublish: policySnsPublish,
      },
    });

    const logGroups = new LogGroup(this, "DestinationAiLogGroup", {
      logGroupName: "/aws/vendedlogs/states/demo-destination-ai",
      retention: RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // Luego creamos el workflow
    const workflow = new StateMachine(this, "DestinationAiMachine", {
      stateMachineName: "DemoDestinationAiAutocomplete",
      stateMachineType: StateMachineType.EXPRESS,
      role: stateMachineRole,
      definitionBody: DefinitionBody.fromFile(
        "statemachine/destination-ai.asl.json", // el asl te permite usar el workflow studio
      ),
      definitionSubstitutions: {
        DataBucketName: dataBucket.bucketName,
        OpenAIConnectionArn: openaiAPIConnection.connectionArn,
      }, //La maquina de estado llamando a la variable de DataBucketName va a poder obtener el nombre del bucket y podra hacer la operación del GetObject
      logs: {
        //agregamos logs
        destination: logGroups,
        level: LogLevel.ALL,
        includeExecutionData: true,
      },
    });

    const credentialsRole = new Role(this, "ApiGatewayDestinationAiRole", {
      assumedBy: new ServicePrincipal("apigateway.amazonaws.com"),
    });

    workflow.grantStartSyncExecution(credentialsRole);

    const confirmDestinationRole = new Role(this, "ConfirmDestinationRole", {
      assumedBy: new ServicePrincipal("states.amazonaws.com"),
      inlinePolicies: {
        S3AccessPolicy: policyS3Access,
        policyInvokeBedrock: policyInvokeBedrock,
        policySnsPublish: policySnsPublish,
      },
    });

    const confirmDestinationWorkflow = new StateMachine(
      this,
      "ConfirmDestinationMachine",
      {
        stateMachineName: "DemoConfirmDestinationMachine",
        role: confirmDestinationRole,
        definitionBody: DefinitionBody.fromFile(
          "statemachine/confirm-destination.asl.json",
        ),
        definitionSubstitutions: {
          DataBucketName: dataBucket.bucketName,
          SNSTopicArn: newDestinationTopic.topicArn,
        },
      },
    );

    // Damos permiso al credentialRole para iniciar la segunda maquina de estado
    confirmDestinationWorkflow.grantStartExecution(credentialsRole);

    const api = new apigateway.RestApi(this, "DestinationAiApi", {
      restApiName: "DemoDestinationAiApi",
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
      },
    });

    api.root.addMethod(
      "POST",
      new apigateway.AwsIntegration({
        service: "states",
        action: "StartSyncExecution",
        options: {
          credentialsRole,
          integrationResponses: [
            {
              statusCode: "200",
              responseParameters: {
                "method.response.header.Access-Control-Allow-Origin": "'*'",
              },

              responseTemplates: {
                "application/json": `#set($inputRoot = $input.path('$'))
                #if($inputRoot.status == "FAILED")
                #set($context.responseOverride.status = 500)
                {"message": "$inputRoot.cause"}
                #else
                  $util.parseJson($inputRoot.output).ResponseBody.choices[0].message.content
                #end`,
              },
            },
          ],
          requestTemplates: {
            "application/json": `{"stateMachineArn":"${workflow.stateMachineArn}",
            "input": "$util.escapeJavaScript($input.json('$'))"
            }`,
          },
        },
      }),
      {
        methodResponses: [
          {
            statusCode: "200",
            responseParameters: {
              "method.response.header.Access-Control-Allow-Origin": true,
            },
          },
          {
            statusCode: "500",
            responseParameters: {
              "method.response.header.Access-Control-Allow-Origin": true,
            },
          },
        ],
      },
    );

    api.root.addResource("confirm").addMethod(
      "POST",
      new apigateway.AwsIntegration({
        service: "states",
        action: "StartExecution",
        options: {
          credentialsRole,
          integrationResponses: [
            {
              statusCode: "200",
              responseParameters: {
                "method.response.header.Access-Control-Allow-Origin": "'*'",
              },
              responseTemplates: {
                "application/json": '{"message" : "Confirmation started"}',
              },
            },
          ],
          requestTemplates: {
            "application/json": `{"stateMachineArn":"${confirmDestinationWorkflow.stateMachineArn}",
            "input": "$util.escapeJavaScript($input.json('$'))"}`,
          },
        },
      }),
      {
        methodResponses: [
          {
            statusCode: "200",
            responseParameters: {
              "method.response.header.Access-Control-Allow-Origin": true,
            },
          },
        ],
      },
    );

    //agregue this.destinationAiWorkflowArn para poner las metricas en el cloudwatch
    this.destinationAiWorkflowArn = new CfnOutput(
      this,
      "CFOutputDestinationAiWorkflowArn",
      {
        value: workflow.stateMachineArn,
      },
    );
    //agregue this.confirmDestinationWorkflowArn para poner las metricas en el cloudwatch
    this.confirmDestinationWorkflowArn = new CfnOutput(
      this,
      "CfnOutputConfirmDestinationMachineArn",
      {
        value: confirmDestinationWorkflow.stateMachineArn,
      },
    );

    // URL del endpoint que dispara la Máquina 1 (autocomplete, sync)
    new CfnOutput(this, "DestinationAiApiUrl", { value: api.url });

    // URL del endpoint que dispara la Máquina 2 (confirm, fire-and-forget)
    new CfnOutput(this, "ConfirmDestinationApiUrl", {
      value: `${api.url}confirm`,
    });
  }
}
